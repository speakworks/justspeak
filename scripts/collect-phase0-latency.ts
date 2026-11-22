/**
 * Phase 0 collector: fills the 20 × 3 latency grid from a folder of recordings.
 *
 *   pnpm bench:latency:collect                    measure and write the grid
 *   pnpm bench:latency:collect --list             parse names and report gaps only
 *   pnpm bench:latency:collect --skip tts         run without the output-side segment
 *   pnpm bench:latency:collect --dir <folder>     somewhere other than the default
 *
 * Input-side segments (endpoint, ASR final, LLM first token) are measured once
 * per recording; the output-side segment (TTS first packet) once per route. The
 * report states that, because 60 filled cells would otherwise read as 60
 * independent measurements.
 *
 * Every failure is recorded as `blocked` with its reason. Nothing here fills a
 * cell with a number it did not observe — the grid gates P1, and a guessed
 * cell would defeat it.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Qwen3AsrProvider } from '../src/core/asr/qwen3-provider'
import {
  findModel,
  findRuntime,
  parseModelCatalog,
  toModelDescriptor
} from '../src/core/asr/model-catalog'
import { TranscribeCliRunner } from '../src/main/asr/cli-runner'
import { LlamaSidecar } from '../src/main/llm/sidecar'
import { decodeWavFile } from './bench-real'
import {
  RECORDING_DIR,
  RECORDING_NAME_PATTERN,
  type CollectRow,
  type RouteLabel,
  aggregateColumns,
  buildRow,
  buildTable,
  coverageOf,
  discoverRecordings,
  parseRouteList
} from './latency-harness/collect'
import { ENDPOINT_CONFIG_SUMMARY, measureEndpoint } from './latency-harness/endpoint'
import { evaluateDegradation, renderDegradationMarkdown } from './latency-harness/gates'
import { measureFirstToken } from './latency-harness/llm'
import {
  TARGET_ROUTES,
  type SegmentResult,
  blockedSegment,
  measuredSegment,
  skippedSegment
} from './latency-harness/report'
import { electronBinaryPath, probeTts } from './latency-harness/tts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

function arg(name: string, fallback?: string): string | undefined {
  const index = args.indexOf(`--${name}`)
  if (index >= 0 && args[index + 1] !== undefined) return args[index + 1]
  return fallback
}

function numberArg(name: string, fallback: number): number {
  const raw = arg(name)
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

const DIR = path.resolve(ROOT, arg('dir', RECORDING_DIR) as string)
const SKIP = new Set(
  (arg('skip', '') as string)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
)
const TTS_SAMPLES = numberArg('tts-samples', 3)
const TTS_TEXT = arg('tts-text', '好的，我记下了。') as string
const LLM_MODEL = arg('llm-model', process.env.JUSTSPEAK_LLM_MODEL)
const LLM_BINARY = path.resolve(ROOT, arg('llm-binary', 'resources/llm/llama-server') as string)
const LLM_PROMPT = '你是听写后处理助手，只做最小幅度的书面化改写。'

const PROMPT_MESSAGES = (text: string) => [
  { role: 'system' as const, content: LLM_PROMPT },
  { role: 'user' as const, content: text }
]

interface AsrAdapter {
  transcribe(file: string): Promise<{ segment: SegmentResult; text: string | null }>
  dispose(): Promise<void>
}

async function prepareAsr(): Promise<AsrAdapter> {
  if (SKIP.has('asr')) {
    return {
      transcribe: async () => ({ segment: skippedSegment('本轮 --skip 包含 asr'), text: null }),
      dispose: async () => undefined
    }
  }
  const blocked = (reason: string): AsrAdapter => ({
    transcribe: async () => ({ segment: blockedSegment(reason), text: null }),
    dispose: async () => undefined
  })
  try {
    const catalog = parseModelCatalog(
      JSON.parse(await readFile(path.join(ROOT, 'resources/models.json'), 'utf8'))
    )
    const model = findModel(catalog, 'qwen3-asr-0.6b-q8')
    const runtime = findRuntime(catalog, model.runtime)
    const descriptor = toModelDescriptor(model)
    const cliPath = path.join(ROOT, runtime.buildDir, runtime.binary)
    const modelPath = path.join(ROOT, 'models', model.files[0].path)
    if (!existsSync(cliPath)) {
      return blocked(`ASR 运行时不存在：${path.relative(ROOT, cliPath)}（需先 pnpm setup:asr）`)
    }
    if (!existsSync(modelPath)) {
      return blocked(`ASR 模型不存在：${path.relative(ROOT, modelPath)}（需先 pnpm setup:asr）`)
    }
    const runner = new TranscribeCliRunner({ cliPath, modelPath, defaultTimeoutMs: 180_000 })
    const provider = new Qwen3AsrProvider({ model: descriptor, runner })
    await provider.prepare(descriptor)
    return {
      transcribe: async (file) => {
        const started = performance.now()
        const result = await provider.transcribe(await decodeWavFile(file), { timeoutMs: 180_000 })
        const wallMs = performance.now() - started
        if (!result.ok) {
          return {
            segment: blockedSegment(`ASR 失败：${result.error.code} ${result.error.message}`),
            text: null
          }
        }
        return {
          segment: measuredSegment([Math.round(wallMs)], {
            file: path.basename(file),
            modelId: model.id,
            definition: 'PCM 校验 + 临时 WAV 写入 + CLI 启动 + 模型加载 + 推理 + 解析'
          }),
          text: result.value.text
        }
      },
      dispose: async () => undefined
    }
  } catch (error) {
    return blocked(`ASR 段异常：${error instanceof Error ? error.message : String(error)}`)
  }
}

interface LlmAdapter {
  firstToken(text: string): Promise<SegmentResult>
  dispose(): Promise<void>
}

async function prepareLlm(): Promise<LlmAdapter> {
  if (SKIP.has('llm')) {
    return {
      firstToken: async () => skippedSegment('本轮 --skip 包含 llm'),
      dispose: async () => undefined
    }
  }
  const noop = async (): Promise<void> => undefined
  if (!existsSync(LLM_BINARY)) {
    return {
      firstToken: async () =>
        blockedSegment(`llama-server 不存在：${path.relative(ROOT, LLM_BINARY)}`),
      dispose: noop
    }
  }
  if (!LLM_MODEL || !existsSync(LLM_MODEL)) {
    return {
      firstToken: async () =>
        blockedSegment(
          '本地 LLM 模型缺失：安装包不内置 gguf，需应用首次运行时下载，或传 --llm-model',
          { modelPath: LLM_MODEL ?? null }
        ),
      dispose: noop
    }
  }
  const apiKey = 'phase0-collect-key'
  const sidecar = new LlamaSidecar({
    binaryPath: LLM_BINARY,
    modelPath: LLM_MODEL,
    apiKey,
    contextSize: 2048
  })
  try {
    await sidecar.start()
  } catch (error) {
    return {
      firstToken: async () =>
        blockedSegment(`sidecar 启动失败：${error instanceof Error ? error.message : String(error)}`),
      dispose: noop
    }
  }
  const baseUrl = sidecar.baseUrl as string
  return {
    firstToken: async (text) => {
      try {
        const measured = await measureFirstToken({
          baseUrl,
          apiKey,
          messages: PROMPT_MESSAGES(text),
          maxTokens: 32
        })
        if (measured === null) {
          return blockedSegment('stream 未验证：sidecar 未返回 SSE，首 token 无法测量')
        }
        return measuredSegment([Math.round(measured.firstTokenMs)], {
          tokens: measured.tokens,
          totalMs: Math.round(measured.totalMs),
          definition: 'POST /v1/chat/completions stream:true → 首个 delta.content 帧'
        })
      } catch (error) {
        return blockedSegment(`LLM 段异常：${error instanceof Error ? error.message : String(error)}`)
      }
    },
    dispose: async () => {
      await sidecar.stop().catch(() => undefined)
    }
  }
}

async function measureTtsByRoute(routes: readonly RouteLabel[]): Promise<Map<RouteLabel, SegmentResult>> {
  const results = new Map<RouteLabel, SegmentResult>()
  for (const route of routes) {
    if (SKIP.has('tts')) {
      results.set(route, skippedSegment('本轮 --skip 包含 tts'))
      continue
    }
    console.log(`[collect] tts probe · route=${route}`)
    const segment = await probeTts({
      electronBinary: electronBinaryPath(ROOT),
      probePath: path.join(ROOT, 'scripts/latency-harness/tts-probe.cjs'),
      cwd: ROOT,
      samples: TTS_SAMPLES,
      text: TTS_TEXT
    })
    results.set(route, segment)
  }
  return results
}

async function measureEndpointFor(file: string): Promise<SegmentResult> {
  if (SKIP.has('endpoint')) return skippedSegment('本轮 --skip 包含 endpoint')
  try {
    const audio = await decodeWavFile(file, { requireCanonicalHeader: true })
    const outcome = measureEndpoint(audio.pcm)
    if (outcome.status === 'blocked') return blockedSegment(outcome.reason)
    return measuredSegment([outcome.endpointMs], {
      lastSpeechFrameMs: outcome.lastSpeechFrameMs,
      confirmedMs: outcome.confirmedMs,
      hysteresisMs: outcome.hysteresisMs,
      silenceMs: outcome.silenceMs,
      regions: outcome.regions,
      config: `${ENDPOINT_CONFIG_SUMMARY.startThreshold}/${ENDPOINT_CONFIG_SUMMARY.endThreshold} · minSilence ${ENDPOINT_CONFIG_SUMMARY.minSilenceMs} ms`,
      definition: 'VAD 最后一个语音帧 → 静音满 minSilence 的确认帧（离线，不含真人声学尾音）'
    })
  } catch (error) {
    return blockedSegment(
      `音频不可用：${error instanceof Error ? error.message : String(error)}（需 16 kHz 单声道 PCM16，44 字节标准头）`
    )
  }
}

function gitCommit(): string {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : 'unknown'
}

async function main(): Promise<void> {
  const routes = parseRouteList(arg('routes', TARGET_ROUTES.join(',')) as string)
  const fileNames = await readdir(DIR).catch(() => [] as string[])
  const discovery = discoverRecordings(fileNames)

  console.log(`[collect] dir=${path.relative(ROOT, DIR)} · 可用素材 ${discovery.recordings.length} 段 · 路由 ${routes.join(',')}`)
  for (const problem of discovery.problems) console.log(`[collect] ! ${problem}`)
  if (args.includes('--list')) {
    for (const recording of discovery.recordings) {
      console.log(`[collect] ${recording.recId} ← ${recording.fileName}`)
    }
    console.log(`[collect] 命名规范：${RECORDING_NAME_PATTERN}`)
    return
  }
  if (discovery.recordings.length === 0) {
    console.log('[collect] 没有可用素材：只写空表与缺口，不编造数字')
  }

  const asr = await prepareAsr()
  const llm = await prepareLlm()
  const ttsByRoute = await measureTtsByRoute(routes)

  const rows: CollectRow[] = []

  try {
    for (const recording of discovery.recordings) {
      const file = path.join(DIR, recording.fileName)
      const endpoint = await measureEndpointFor(file)
      const asrResult = await asr.transcribe(file)
      const llmSegment = asrResult.text
        ? await llm.firstToken(asrResult.text)
        : blockedSegment('上游 ASR 未产出文本，未构造 LLM 请求')
      console.log(
        `[collect] ${recording.recId} endpoint=${endpoint.status} asr=${asrResult.segment.status} ` +
          `llm=${llmSegment.status}`
      )
      for (const route of routes) {
        rows.push(
          buildRow(recording.recId, route, {
            endpoint,
            asrFinal: asrResult.segment,
            llmFirstToken: llmSegment,
            ttsFirstPacket: ttsByRoute.get(route) ?? blockedSegment('该路由未运行 TTS 探针')
          })
        )
      }
    }
  } finally {
    await asr.dispose()
    await llm.dispose()
  }

  const coverage = coverageOf(rows)
  const aggregate = aggregateColumns(rows)
  const verdict = evaluateDegradation({
    endpoint: aggregate.endpoint,
    asrFinal: aggregate.asrFinal,
    ttsFirstPacket: aggregate.ttsFirstPacket
  })

  const date = new Date()
  const day = date.toISOString().slice(0, 10)
  const commit = gitCommit()
  const appVersion = (
    JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }
  ).version
  const runId = `${day}-${commit}`

  const report = {
    schemaVersion: 1,
    kind: 'speakpilot-phase0-collect',
    runId,
    generatedAt: date.toISOString(),
    gitCommit: commit,
    appVersion,
    routes,
    recordings: discovery.recordings.map((recording) => recording.recId),
    coverage,
    aggregate,
    degradation: verdict,
    problems: discovery.problems,
    note: '输入侧三段每段素材测一次并复制到三条路由；TTS 首包按路由各测一次。60 格不是 60 次独立测量。',
    rows
  }

  const resultsDir = path.join(ROOT, 'bench/results')
  const reportsDir = path.join(ROOT, 'bench/reports')
  await mkdir(resultsDir, { recursive: true })
  await mkdir(reportsDir, { recursive: true })
  const jsonPath = path.join(resultsDir, `phase0-collect-${runId}.json`)
  const markdownPath = path.join(reportsDir, `${day}-phase0-latency.md`)
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(markdownPath, renderMarkdown({ report, rows, coverage, aggregate, verdict, discovery, ttsByRoute, appVersion, generatedAt: date.toISOString() }))

  console.log(`[collect] 覆盖：${coverage.measuredColumns} 实测列 / ${coverage.blockedColumns} blocked 列 / ${coverage.missingRows} 缺行（共 ${coverage.gridRows} 行）`)
  console.log(`[collect] L2 判定：${verdict.allowL2 === null ? '未判定' : verdict.allowL2 ? '允许' : '不允许'} · 触发规则 ${verdict.failingRules.join(',') || '无'}`)
  console.log(`[collect] results: ${path.relative(ROOT, jsonPath)}`)
  console.log(`[collect] report:  ${path.relative(ROOT, markdownPath)}`)
}

interface RenderInput {
  report: { runId: string; gitCommit: string; generatedAt: string }
  rows: readonly CollectRow[]
  coverage: ReturnType<typeof coverageOf>
  aggregate: ReturnType<typeof aggregateColumns>
  verdict: ReturnType<typeof evaluateDegradation>
  discovery: ReturnType<typeof discoverRecordings>
  ttsByRoute: Map<RouteLabel, SegmentResult>
  appVersion: string
  generatedAt: string
}

function renderMarkdown(input: RenderInput): string {
  const { rows, coverage, aggregate, verdict, discovery } = input
  const problems = discovery.problems.length
    ? discovery.problems.map((problem) => `- ${problem}`).join('\n')
    : '- 无'
  const ttsLines = [...input.ttsByRoute.entries()]
    .map(([route, segment]) => `- \`${route}\`: ${segment.status}${segment.summary ? ` · P50 ${segment.summary.p50Ms} ms（n=${segment.summary.count}）` : ` — ${segment.reason}`}`)
    .join('\n')

  return `# SpeakPilot Phase 0 延迟实测表 — ${input.report.runId}

- Commit: \`${input.report.gitCommit}\` · 版本 \`${input.appVersion}\`
- 生成时间: ${input.generatedAt}
- 素材：${coverage.recordings} 段 · 路由：${coverage.routes} 条
- 覆盖：${coverage.rows} / ${coverage.gridRows} 行已生成；实测 ${coverage.measuredColumns} 列，blocked ${coverage.blockedColumns} 列；缺素材 ${coverage.missingRows} 行

## 说明

- 端点、ASR 终稿、LLM 首 token 属输入侧：每段素材测一次，复制到该素材的三条路由行。
- TTS 首包属输出侧：每条路由测一次，应用于该路由的 20 行。
- M1 = 四列 P50 相加，是算术和，不是真人听感；上机后必须用听感值校准。
- 空格子写 \`待填\`，测不到写 \`blocked\` 并注明原因，禁止填估计值。

## 表格

| 素材 | 路由 | 端点 (ms) | ASR 终稿 (ms) | LLM 首 token (ms) | TTS 首包 (ms) | M1 (ms) |
|---|---|---|---:|---:|---:|---:|---:|
${buildTable(rows)}

## 按环节汇总（各行样本汇总）

| 环节 | 状态 | P50 (ms) | P95 (ms) | n |
|---|---|---:|---:|---:|
| 端点 | ${aggregate.endpoint.status}${aggregate.endpoint.summary ? '' : `（${aggregate.endpoint.reason}）`} | ${aggregate.endpoint.summary?.p50Ms ?? '—'} | ${aggregate.endpoint.summary?.p95Ms ?? '—'} | ${aggregate.endpoint.summary?.count ?? 0} |
| ASR 终稿 | ${aggregate.asrFinal.status}${aggregate.asrFinal.summary ? '' : `（${aggregate.asrFinal.reason}）`} | ${aggregate.asrFinal.summary?.p50Ms ?? '—'} | ${aggregate.asrFinal.summary?.p95Ms ?? '—'} | ${aggregate.asrFinal.summary?.count ?? 0} |
| LLM 首 token | ${aggregate.llmFirstToken.status}${aggregate.llmFirstToken.summary ? '' : `（${aggregate.llmFirstToken.reason}）`} | ${aggregate.llmFirstToken.summary?.p50Ms ?? '—'} | ${aggregate.llmFirstToken.summary?.p95Ms ?? '—'} | ${aggregate.llmFirstToken.summary?.count ?? 0} |
| TTS 首包 | ${aggregate.ttsFirstPacket.status}${aggregate.ttsFirstPacket.summary ? '' : `（${aggregate.ttsFirstPacket.reason}）`} | ${aggregate.ttsFirstPacket.summary?.p50Ms ?? '—'} | ${aggregate.ttsFirstPacket.summary?.p95Ms ?? '—'} | ${aggregate.ttsFirstPacket.summary?.count ?? 0} |

TTS 按路由：

${ttsLines || '- 无'}

## 素材缺口与命名问题

${problems}

${renderDegradationMarkdown(verdict)}

## 读数注意

- \`blocked\` 不是 0，也不是达标；它表示这台机器当前缺前提。
- 路由由操作者声明；脚本只记录默认输出设备名，无法证明声音真的从该设备出去。
- 这些数字属于这台机器在这个 commit 上的表现，不代表产品在其他 Mac 上的行为。
- M4 / M6 / M7 需要真人听感与本机房间声学，任何脚本都无法替代。
`
}

await main()
