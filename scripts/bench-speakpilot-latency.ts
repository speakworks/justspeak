/**
 * SpeakPilot Phase 0 latency harness.
 *
 * Measures the three segments that can be measured on this machine today,
 * independently and honestly:
 *
 *   asr — the existing batch ASR path on `bench/fixtures/zh-4s.wav`
 *   llm — first token from the bundled llama-server sidecar (streaming), plus
 *         a non-streaming reference number
 *   tts — first audio callback from Chromium's speechSynthesis, 20 samples
 *
 *   pnpm bench:latency                       all three segments, default samples
 *   pnpm bench:latency --segments asr        one segment
 *   pnpm bench:latency --template-only       write the empty Phase 0 grid
 *
 * A segment whose prerequisites are missing is recorded as `blocked` with the
 * reason. It is never recorded as 0 ms and never estimated: the whole point of
 * this file is the gate in §g ("no measured table, no P1") which a fabricated
 * number would silently defeat.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
  type RouteInfo,
  type SegmentResult,
  blockedSegment,
  classifyTtsProbe,
  buildReport,
  measuredSegment,
  renderMarkdown,
  renderPhase0Template,
  skippedSegment
} from './latency-harness/report'
import { summarize } from './latency-harness/stats'

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

const SEGMENTS = (arg('segments', 'asr,llm,tts') as string)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const ROUTE_LABEL = arg('route', 'built-in') as string
const ASR_RUNS = numberArg('asr-runs', 1)
const LLM_SAMPLES = numberArg('llm-samples', 20)
const TTS_SAMPLES = numberArg('tts-samples', 20)
const TTS_TEXT = arg('tts-text', '今天天气不错，我们下午三点开会。') as string
const LLM_MODEL = arg('llm-model', process.env.JUSTSPEAK_LLM_MODEL)
const LLM_BINARY = path.resolve(ROOT, arg('llm-binary', 'resources/llm/llama-server') as string)

function sysctl(name: string): string {
  return spawnSync('sysctl', ['-n', name], { encoding: 'utf8' }).stdout.trim()
}

function gitCommit(): string {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  return result.status === 0 ? result.stdout.trim() : 'unknown'
}

function screenLocked(): boolean {
  const output = spawnSync('ioreg', ['-n', 'Root', '-d1', '-a'], { encoding: 'utf8' }).stdout
  return output.includes('CGSSessionScreenIsLocked')
}

/** Best-effort default output device name; null when the query is unavailable. */
function defaultOutputDevice(): string | null {
  const result = spawnSync('system_profiler', ['SPAudioDataType'], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024
  })
  if (result.status !== 0) return null
  let candidate: string | null = null
  for (const rawLine of result.stdout.split('\n')) {
    const line = rawLine.trimEnd()
    const indent = line.length - line.trimStart().length
    if (indent === 8 && line.endsWith(':')) {
      candidate = line.trim().replace(/:$/, '')
    }
    if (line.includes('Default System Output Device: Yes')) return candidate
  }
  return null
}

async function runAsrSegment(): Promise<SegmentResult> {
  if (!SEGMENTS.includes('asr')) return skippedSegment('未在本轮请求中（--segments 未包含 asr）')
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
      return blockedSegment(`ASR 运行时不存在：${path.relative(ROOT, cliPath)}（需先 pnpm setup:asr）`)
    }
    if (!existsSync(modelPath)) {
      return blockedSegment(`ASR 模型不存在：${path.relative(ROOT, modelPath)}（需先 pnpm setup:asr）`)
    }
    const fixtureDir = path.join(ROOT, 'bench/fixtures')
    const manifest = JSON.parse(await readFile(path.join(fixtureDir, 'manifest.json'), 'utf8')) as {
      fixtures: Array<{ id: string; path: string; durationSec: number }>
    }
    const fixture = manifest.fixtures[0]
    const audio = await decodeWavFile(path.join(fixtureDir, fixture.path))

    const runner = new TranscribeCliRunner({ cliPath, modelPath, defaultTimeoutMs: 180_000 })
    const provider = new Qwen3AsrProvider({ model: descriptor, runner })
    await provider.prepare(descriptor)

    const samples: number[] = []
    for (let run = 1; run <= ASR_RUNS; run += 1) {
      const started = performance.now()
      const result = await provider.transcribe(audio, { timeoutMs: 180_000 })
      const wallMs = performance.now() - started
      if (!result.ok) {
        return blockedSegment(`ASR 第 ${run} 次运行失败：${result.error.code} ${result.error.message}`)
      }
      samples.push(wallMs)
      console.log(`[latency] asr run ${run}: ${Math.round(wallMs)} ms · "${result.value.text}"`)
    }
    return measuredSegment(samples, {
      fixture: fixture.id,
      fixtureDurationSec: fixture.durationSec,
      modelId: model.id,
      runtimeId: runtime.id,
      definition: 'provider.transcribe 墙钟时间：PCM 校验 + 临时 WAV 写入 + CLI 启动 + 模型加载 + 推理 + 解析',
      pathNote: '现有批处理路径，不是流式；不能代表 partial 首字延迟'
    })
  } catch (error) {
    return blockedSegment(
      `ASR 段异常：${error instanceof Error ? error.message : String(error)}`
    )
  }
}

interface StreamMeasurement {
  firstTokenMs: number
  totalMs: number
  tokens: number
}

const BENCH_PROMPT = [
  { role: 'system', content: '你是听写后处理助手，只做最小幅度的书面化改写。' },
  { role: 'user', content: '嗯就是那个我们明天上午十点开会记得带上笔记本' }
]

async function streamFirstToken(
  baseUrl: string,
  apiKey: string,
  maxTokens: number
): Promise<StreamMeasurement | null> {
  const started = performance.now()
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'local',
      temperature: 0,
      max_tokens: maxTokens,
      stream: true,
      messages: BENCH_PROMPT
    })
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  if (!response.body) throw new Error('no response body')
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    await response.text()
    return null
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let firstTokenMs: number | null = null
  let tokens = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: unknown } }>
          }
          const content = parsed.choices?.[0]?.delta?.content
          if (typeof content === 'string' && content.length > 0) {
            tokens += 1
            if (firstTokenMs === null) firstTokenMs = performance.now() - started
          }
        } catch {
          // keep-alive comments and partial frames are not errors
        }
      }
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }
  if (firstTokenMs === null) return null
  const totalMs = performance.now() - started
  console.log(`[latency] llm stream: first ${Math.round(firstTokenMs)} ms · ${tokens} token(s) · total ${Math.round(totalMs)} ms`)
  return { firstTokenMs, totalMs, tokens }
}

async function streamNonStreaming(baseUrl: string, apiKey: string): Promise<number> {
  const started = performance.now()
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'local',
      temperature: 0,
      max_tokens: 32,
      stream: false,
      messages: BENCH_PROMPT
    })
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  await response.json()
  return performance.now() - started
}

async function runLlmSegment(): Promise<SegmentResult> {
  if (!SEGMENTS.includes('llm')) return skippedSegment('未在本轮请求中（--segments 未包含 llm）')
  if (!existsSync(LLM_BINARY)) {
    return blockedSegment(`llama-server 不存在：${path.relative(ROOT, LLM_BINARY)}`, {
      binaryPath: LLM_BINARY
    })
  }
  if (!LLM_MODEL || !existsSync(LLM_MODEL)) {
    return blockedSegment(
      '本地 LLM 模型缺失：安装包不内置 gguf，需应用首次运行时下载，或传 --llm-model / JustSpeak 数据目录下的 .gguf',
      { binaryPath: LLM_BINARY, modelPath: LLM_MODEL ?? null }
    )
  }

  const apiKey = 'latency-harness-key'
  const sidecar = new LlamaSidecar({
    binaryPath: LLM_BINARY,
    modelPath: LLM_MODEL,
    apiKey,
    contextSize: 2048
  })
  try {
    await sidecar.start()
  } catch (error) {
    return blockedSegment(
      `sidecar 启动失败：${error instanceof Error ? error.message : String(error)}`,
      { binaryPath: LLM_BINARY, modelPath: LLM_MODEL }
    )
  }

  try {
    const baseUrl = sidecar.baseUrl as string
    const samples: number[] = []
    let streamingUnsupported = false
    for (let run = 1; run <= LLM_SAMPLES; run += 1) {
      const measured = await streamFirstToken(baseUrl, apiKey, 24)
      if (measured === null) {
        streamingUnsupported = true
        break
      }
      samples.push(measured.firstTokenMs)
    }
    if (streamingUnsupported || samples.length === 0) {
      const nonStreamMs = await streamNonStreaming(baseUrl, apiKey)
      return blockedSegment(
        'stream 未验证：llama-server 未返回 SSE（application/json），首 token 无法测量；已记录非流式完成时间供参考',
        {
          binaryPath: LLM_BINARY,
          modelPath: LLM_MODEL,
          nonStreamingMs: Math.round(nonStreamMs),
          nonStreamingP50Ms: summarize([nonStreamMs])?.p50Ms ?? null
        }
      )
    }
    const nonStreamMs = await streamNonStreaming(baseUrl, apiKey)
    return measuredSegment(
      samples.map((value) => Math.round(value)),
      {
        binaryPath: LLM_BINARY,
        modelPath: LLM_MODEL,
        streaming: 'verified',
        sampleCount: samples.length,
        nonStreamingMs: Math.round(nonStreamMs),
        definition: 'POST /v1/chat/completions stream:true → 首个含 delta.content 的 SSE 帧',
        pathNote: 'sidecar 直连，不含 IPC 与界面渲染'
      }
    )
  } catch (error) {
    return blockedSegment(
      `LLM 段异常：${error instanceof Error ? error.message : String(error)}`,
      { binaryPath: LLM_BINARY, modelPath: LLM_MODEL }
    )
  } finally {
    await sidecar.stop().catch(() => undefined)
  }
}

interface ProbePayload {
  startMs: number[]
  boundaryMs: number[]
  errors: string[]
  voiceCount: number
  zhVoice: string | null
}

function electronBinary(): string {
  return path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
}

async function runTtsSegment(): Promise<SegmentResult> {
  if (!SEGMENTS.includes('tts')) return skippedSegment('未在本轮请求中（--segments 未包含 tts）')
  const binary = electronBinary()
  if (!existsSync(binary)) {
    return blockedSegment(`Electron 不存在：${path.relative(ROOT, binary)}（需先安装依赖）`)
  }
  const probePath = path.join(ROOT, 'scripts/latency-harness/tts-probe.cjs')
  const payload = await new Promise<ProbePayload | { spawnError: string }>((resolve) => {
    const child = spawn(binary, [probePath, '--samples', String(TTS_SAMPLES), '--text', TTS_TEXT], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ spawnError: `探针超过 180 秒未返回（请求 ${TTS_SAMPLES} 次）` })
    }, 180_000)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ spawnError: error.message })
    })
    child.on('close', () => {
      clearTimeout(timer)
      const line = stdout.split('\n').find((value) => value.startsWith('HARNESS_RESULT '))
      if (!line) {
        resolve({ spawnError: `探针无结果输出：${stderr.slice(-300) || '(空)'}` })
        return
      }
      try {
        resolve(JSON.parse(line.slice('HARNESS_RESULT '.length)) as ProbePayload)
      } catch (error) {
        resolve({ spawnError: `探针结果无法解析：${error instanceof Error ? error.message : String(error)}` })
      }
    })
  })

  if ('spawnError' in payload) return blockedSegment(payload.spawnError)
  if (payload.startMs.length < TTS_SAMPLES && payload.startMs.length > 0) {
    console.warn(
      `[latency] tts: 只拿到 ${payload.startMs.length}/${TTS_SAMPLES} 次样本，按实际次数统计`
    )
  }
  return classifyTtsProbe(payload, TTS_SAMPLES)
}

async function main(): Promise<void> {
  const date = new Date()
  const day = date.toISOString().slice(0, 10)
  const commit = gitCommit()

  if (args.includes('--template-only')) {
    const reportsDir = path.join(ROOT, 'bench/reports')
    await mkdir(reportsDir, { recursive: true })
    const templatePath = path.join(reportsDir, 'phase0-latency-template.md')
    await writeFile(templatePath, renderPhase0Template())
    console.log(`[latency] template: ${path.relative(ROOT, templatePath)}`)
    return
  }

  console.log(
    `[latency] segments=${SEGMENTS.join('+')} · route=${ROUTE_LABEL} · asr=${ASR_RUNS} · llm=${LLM_SAMPLES} · tts=${TTS_SAMPLES}`
  )

  const ttsSegmentPromise = runTtsSegment()
  const llmSegmentPromise = runLlmSegment()
  const asrSegment = await runAsrSegment()
  const llmSegment = await llmSegmentPromise
  const ttsSegment = await ttsSegmentPromise

  const hardware = {
    chip: sysctl('machdep.cpu.brand_string'),
    cores: Number(sysctl('hw.ncpu')),
    memoryBytes: Number(sysctl('hw.memsize')),
    macOS: spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim(),
    powerState: spawnSync('pmset', ['-g', 'batt'], { encoding: 'utf8' }).stdout.trim().slice(0, 80)
  }
  const route: RouteInfo = {
    label: ROUTE_LABEL,
    outputDevice: defaultOutputDevice(),
    screenLocked: screenLocked()
  }

  const report = buildReport({
    gitCommit: commit,
    appVersion: (JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')) as {
      version: string
    }).version,
    generatedAt: date.toISOString(),
    hardware,
    route,
    segments: { asrFinal: asrSegment, llmFirstToken: llmSegment, ttsFirstPacket: ttsSegment },
    llm: {
      binaryPath: existsSync(LLM_BINARY) ? LLM_BINARY : null,
      modelPath: LLM_MODEL ?? null,
      modelId: LLM_MODEL ? path.basename(LLM_MODEL) : null,
      streaming: llmSegment.status === 'measured' ? 'verified' : 'not-run'
    },
    phase0Coverage: { recordings: 0, routes: 1 }
  })

  const resultsDir = path.join(ROOT, 'bench/results')
  const reportsDir = path.join(ROOT, 'bench/reports')
  await mkdir(resultsDir, { recursive: true })
  await mkdir(reportsDir, { recursive: true })
  const jsonPath = path.join(resultsDir, `${report.runId}.json`)
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  const reportPath = path.join(reportsDir, `${day}-speakpilot-latency-${ROUTE_LABEL}.md`)
  await writeFile(reportPath, renderMarkdown(report))
  const templatePath = path.join(reportsDir, 'phase0-latency-template.md')
  if (!existsSync(templatePath)) await writeFile(templatePath, renderPhase0Template())

  for (const [key, segment] of Object.entries(report.segments)) {
    const label = segment.summary
      ? `P50 ${segment.summary.p50Ms} ms · P95 ${segment.summary.p95Ms} ms · n=${segment.summary.count}`
      : `${segment.status} — ${segment.reason}`
    console.log(`[latency] ${key}: ${label}`)
  }
  console.log(`[latency] results: ${path.relative(ROOT, jsonPath)}`)
  console.log(`[latency] report:  ${path.relative(ROOT, reportPath)}`)
}

await main()
