/**
 * Report shape and rendering for the SpeakPilot latency harness.
 *
 * Two rules drive everything in this file:
 *
 * 1. A segment that was not measured is `blocked` or `skipped`, never `0 ms`.
 *    The harness exists because §g of the conversation plan says "no measured
 *    table, no P1", so a silent zero would quietly defeat the gate it is meant
 *    to serve.
 * 2. Nothing here decides that the product "passed". Gates only report
 *    true / false / null against the thresholds in §f.1 and §f.3; the decision
 *    to enter P1 stays with the owner.
 */

import { type LatencySummary, meetsThreshold, summarize } from './stats'

export type SegmentStatus = 'measured' | 'blocked' | 'skipped'

export interface SegmentResult {
  status: SegmentStatus
  /** Required for blocked / skipped; must be null when measured. */
  reason: string | null
  samplesMs: number[]
  summary: LatencySummary | null
  detail: Record<string, string | number | boolean | null>
}

export interface RouteInfo {
  /** Labels are declared by the operator; the harness cannot prove the routing. */
  label: string
  outputDevice: string | null
  screenLocked: boolean
}

export interface HarnessHardware {
  chip: string
  cores: number
  memoryBytes: number
  macOS: string
  powerState: string
}

export interface HarnessSegments {
  asrFinal: SegmentResult
  llmFirstToken: SegmentResult
  ttsFirstPacket: SegmentResult
}

export interface Phase0Coverage {
  recordings: number
  routes: number
}

export interface HarnessInput {
  gitCommit: string
  appVersion: string
  generatedAt: string
  hardware: HarnessHardware
  route: RouteInfo
  segments: HarnessSegments
  /** Which LLM artefacts were used; null when the segment never ran. */
  llm: {
    binaryPath: string | null
    modelPath: string | null
    modelId: string | null
    streaming: 'verified' | 'unverified' | 'not-run'
  }
  phase0Coverage?: Phase0Coverage
}

export interface LatencyGates {
  ttsFirstPacketP50Under500ms: boolean | null
  ttsFirstPacketP50Under400ms: boolean | null
  asrFinalP50Under1000ms: boolean | null
  llmFirstTokenP50Under150ms: boolean | null
  phase0TableComplete: boolean
}

export interface HarnessReport extends HarnessInput {
  schemaVersion: 1
  kind: 'speakpilot-latency-harness'
  runId: string
  gates: LatencyGates
  samplePlan: {
    targetRecordings: number
    targetRoutes: string[]
    note: string
  }
  caveats: string[]
}

export function measuredSegment(
  samplesMs: number[],
  detail: Record<string, string | number | boolean | null> = {}
): SegmentResult {
  if (samplesMs.length === 0) {
    throw new Error('measuredSegment requires at least one sample')
  }
  return {
    status: 'measured',
    reason: null,
    samplesMs,
    summary: summarize(samplesMs),
    detail
  }
}

export function blockedSegment(
  reason: string,
  detail: Record<string, string | number | boolean | null> = {}
): SegmentResult {
  if (reason.trim().length === 0) throw new Error('blockedSegment requires a reason')
  return { status: 'blocked', reason, samplesMs: [], summary: null, detail }
}

export function skippedSegment(
  reason: string,
  detail: Record<string, string | number | boolean | null> = {}
): SegmentResult {
  if (reason.trim().length === 0) throw new Error('skippedSegment requires a reason')
  return { status: 'skipped', reason, samplesMs: [], summary: null, detail }
}

export const TARGET_ROUTES = ['built-in', 'wired', 'bluetooth'] as const
export const TARGET_RECORDINGS = 20

/** Below this a callback cannot plausibly represent audible speech. */
const IMPLAUSIBLE_FIRST_PACKET_MS = 20

export interface TtsProbeLike {
  startMs: number[]
  boundaryMs?: number[]
  errors?: string[]
  voiceCount: number
  zhVoice?: string | null
}

/**
 * Turns a raw speechSynthesis probe into a segment result, refusing to call a
 * run "measured" when the engine never had a voice to speak with. Observed on
 * this machine: with `voices=0` the callbacks still fire, at 1–478 ms, and a
 * naive harness would have reported a spectacular TTS latency that was simply
 * a silent no-op.
 */
export function classifyTtsProbe(payload: TtsProbeLike, requestedSamples: number): SegmentResult {
  const errors = payload.errors ?? []
  const boundarySummary = summarize(payload.boundaryMs ?? [])
  const baseDetail = {
    voiceCount: payload.voiceCount,
    zhVoice: payload.zhVoice ?? null,
    requestedSamples,
    boundarySamples: (payload.boundaryMs ?? []).length,
    boundaryP50Ms: boundarySummary?.p50Ms ?? null,
    boundaryP95Ms: boundarySummary?.p95Ms ?? null,
    errors: errors.join(';')
  }
  if (errors.some((value) => value === 'timeout')) {
    return blockedSegment('TTS 探针超时：utterance 未在 15 秒内结束', baseDetail)
  }
  if (payload.voiceCount === 0) {
    return blockedSegment(
      `speechSynthesis 未加载任何语音（voices=0），onstart 回调不代表真实出声，样本作废`,
      baseDetail
    )
  }
  if (payload.startMs.length === 0) {
    return blockedSegment(
      `TTS 未产生 onstart 回调：${errors.join(' / ') || '无错误信息'}`,
      baseDetail
    )
  }
  const summary = summarize(payload.startMs)
  if (summary !== null && summary.p50Ms < IMPLAUSIBLE_FIRST_PACKET_MS) {
    return blockedSegment(
      `TTS 首包 P50 ${summary.p50Ms} ms 低于 ${IMPLAUSIBLE_FIRST_PACKET_MS} ms，疑似未真正出声（无声卡或锁屏），样本作废`,
      { ...baseDetail, rejectedP50Ms: summary.p50Ms }
    )
  }
  return measuredSegment(payload.startMs.map((value) => Math.round(value)), {
    ...baseDetail,
    definition:
      'speechSynthesis.speak() → utterance.onstart；boundary 为第一个 willSpeakRangeOfSpeechString 回调',
    pathNote: 'Chromium speechSynthesis（内嵌 AVSpeechSynthesizer），隐藏窗口，不含播放启动 50 ms'
  })
}

export function evaluateGates(segments: HarnessSegments, coverage: Phase0Coverage): LatencyGates {
  return {
    ttsFirstPacketP50Under500ms: meetsThreshold(segments.ttsFirstPacket.summary, 500),
    ttsFirstPacketP50Under400ms: meetsThreshold(segments.ttsFirstPacket.summary, 400),
    asrFinalP50Under1000ms: meetsThreshold(segments.asrFinal.summary, 1_000),
    llmFirstTokenP50Under150ms: meetsThreshold(segments.llmFirstToken.summary, 150),
    phase0TableComplete: coverage.recordings >= TARGET_RECORDINGS && coverage.routes >= 3
  }
}

const FIXED_CAVEATS = [
  'A `blocked` segment is not a pass and not a zero; it means the harness could not measure it on this machine with its current prerequisites.',
  'Route labels are declared by the operator. The harness records the default output device name but cannot prove that audio actually left through it.',
  'These numbers describe this machine at this commit. They are not a claim about any other Mac and not a claim about the product as shipped.',
  'Subjects were not measured here: echo mis-trigger rate (M4), re-say rate after interruption (M6) and round-trip conversational latency (M1) all need real two-person audio and a listening check.'
]

export function buildReport(input: HarnessInput): HarnessReport {
  const coverage = input.phase0Coverage ?? { recordings: 0, routes: 1 }
  const runId = `${input.generatedAt.slice(0, 10)}-${input.gitCommit}-${input.route.label}`
  const report: HarnessReport = {
    ...input,
    schemaVersion: 1,
    kind: 'speakpilot-latency-harness',
    runId,
    gates: evaluateGates(input.segments, coverage),
    samplePlan: {
      targetRecordings: TARGET_RECORDINGS,
      targetRoutes: [...TARGET_ROUTES],
      note: 'Phase 0 needs 20 real two-person recordings across the three routes; the harness only supplies the per-segment machinery, not the audio.'
    },
    caveats: FIXED_CAVEATS
  }
  for (const key of ['asrFinal', 'llmFirstToken', 'ttsFirstPacket'] as const) {
    const segment = report.segments[key]
    if (segment.status === 'measured' && segment.summary === null) {
      throw new Error(`${key}: measured segment has no summary`)
    }
    if (segment.status !== 'measured' && (segment.reason ?? '').trim().length === 0) {
      throw new Error(`${key}: ${segment.status} segment has no reason`)
    }
  }
  return report
}

function segmentRow(label: string, segment: SegmentResult): string {
  if (segment.status === 'measured' && segment.summary) {
    const summary = segment.summary
    return `| ${label} | 实测 ${summary.count} 次 | ${summary.p50Ms} | ${summary.p95Ms} | ${summary.minMs} | ${summary.maxMs} |`
  }
  return `| ${label} | ${segment.status === 'blocked' ? 'blocked' : 'skipped'} | — | — | — | — |`
}

function gateCell(value: boolean | null): string {
  if (value === null) return '未测'
  return value ? '达标' : '未达标'
}

export function renderMarkdown(report: HarnessReport): string {
  const { segments, gates, route, hardware, llm } = report
  const measured = Object.values(segments).filter((segment) => segment.status === 'measured')
  const blocked = Object.entries(segments).filter(([, segment]) => segment.status !== 'measured')

  const reasons = blocked.length
    ? blocked.map(([key, segment]) => `- \`${key}\`: ${segment.status} — ${segment.reason}`).join('\n')
    : '- 无：三段全部测到。'

  const llmLine =
    segments.llmFirstToken.status === 'measured'
      ? `stream: \`${llm.streaming}\` · 模型 \`${llm.modelId ?? 'unknown'}\``
      : `未运行（模型 \`${llm.modelPath ?? 'none'}\`）`

  return `# SpeakPilot 延迟实测脚手架运行记录 — ${report.runId}

- Commit: \`${report.gitCommit}\` · 版本 \`${report.appVersion}\`
- 生成时间: ${report.generatedAt}
- 机器: ${hardware.chip} · ${hardware.cores} 核 · ${(hardware.memoryBytes / 1e9).toFixed(0)} GB · macOS ${hardware.macOS}
- 电源: ${hardware.powerState || 'unknown'}
- 路由: \`${route.label}\` · 默认输出设备 ${route.outputDevice ?? 'unknown'} · 屏幕锁 ${route.screenLocked ? 'locked' : 'unlocked'}
- 实测段: ${measured.length} / 3

## 分段结果

| 环节 | 状态 | P50 (ms) | P95 (ms) | Min (ms) | Max (ms) |
|---|---|---:|---:|---:|---:|
${segmentRow('ASR 终稿（zh-4s 单条冒烟）', segments.asrFinal)}
${segmentRow('LLM 首 token', segments.llmFirstToken)}
${segmentRow('TTS 首包', segments.ttsFirstPacket)}

LLM 路径: ${llmLine}

未测 / 阻断原因:

${reasons}

## 与 §f.1 预算的对照

| 环节 | §f.1 预算 | 本次实测 P50 | 判定 |
|---|---:|---:|---|
| ASR 终稿确认 | 150 ms | ${segments.asrFinal.summary?.p50Ms ?? '未测'} | ${gateCell(gates.asrFinalP50Under1000ms)} |
| LLM 首 token | 150 ms | ${segments.llmFirstToken.summary?.p50Ms ?? '未测'} | ${gateCell(gates.llmFirstTokenP50Under150ms)} |
| TTS 首包 | 250 ms | ${segments.ttsFirstPacket.summary?.p50Ms ?? '未测'} | ${gateCell(gates.ttsFirstPacketP50Under500ms)} |

## §f.3 降级规则的机械判读

| 规则 | 触发条件 | 本次数据 | 结论 |
|---|---|---|---|
| TTS 首包 > 500 ms | P50 > 500 | ${segments.ttsFirstPacket.summary?.p50Ms ?? '未测'} | ${gateCell(gates.ttsFirstPacketP50Under500ms)} |
| TTS 短句切分后仍 > 400 ms | P50 > 400 | ${segments.ttsFirstPacket.summary?.p50Ms ?? '未测'} | ${gateCell(gates.ttsFirstPacketP50Under400ms)} |
| 端点 + ASR 终稿 P50 > 1.0 s | P50 > 1000 | ${segments.asrFinal.summary?.p50Ms ?? '未测'}（仅终稿，端点未含） | ${gateCell(gates.asrFinalP50Under1000ms)} |
| Phase 0 表齐（20 段 × 3 路由） | 20 段 / 3 路由 | ${report.phase0Coverage?.recordings ?? 0} 段 / ${report.phase0Coverage?.routes ?? 1} 路由 | ${gates.phase0TableComplete ? '齐全' : '未齐'} |

## 读数注意

${report.caveats.map((caveat) => `- ${caveat}`).join('\n')}

- JSON: \`bench/results/${report.runId}.json\`（无文本内容，只有时间戳与样本毫秒数）
- Phase 0 空白表: \`bench/reports/phase0-latency-template.md\`
`
}

/** The Phase 0 grid the owner fills by hand once real audio exists. */
export function renderPhase0Template(): string {
  const routes = TARGET_ROUTES
  const rows: string[] = []
  for (let index = 1; index <= TARGET_RECORDINGS; index += 1) {
    const id = `rec-${String(index).padStart(2, '0')}`
    for (const route of routes) {
      rows.push(`| ${id} | ${route} | 待填 | 待填 | 待填 | 待填 | 待填 |`)
    }
  }
  return `# SpeakPilot Phase 0 延迟实测表（空白模板）

每段素材 × 每条路由一行，共 ${TARGET_RECORDINGS} × ${routes.length} = ${TARGET_RECORDINGS * routes.length} 行。
**空格子必须由实测填充；测不到的写 \`blocked\` 并注明原因，不许写估计值。**

列定义对齐 \`docs/SPEAKPILOT-CONVERSATION-PLAN.md\` §f.1：

- 端点: 用户停说 → VAD 判定说完（当前实现 \`minSilenceMs\` 400 ms）
- ASR 终稿: 说完 → 拿到 final 文本
- LLM 首 token: 请求发出 → 第一个 token 到达
- TTS 首包: 调用 speak → 第一个语音单元回调
- M1 停说→出声: 用户最后一个字结束 → 第一个可听音（三个环节之和，用真人听感校准）

| 素材 | 路由 | 端点 (ms) | ASR 终稿 (ms) | LLM 首 token (ms) | TTS 首包 (ms) | M1 停说→出声 (ms) |
|---|---|---|---:|---:|---:|---:|---:|
${rows.join('\n')}

回填后把这张表的数据抄进 \`docs/SPEAKPILOT-CONVERSATION-PLAN.md\` §f.1 的"现有手段"列旁边的新增实测列，并在 §g Phase 0 的验收行打勾。
`
}
