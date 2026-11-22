/**
 * §f.3 of the conversation plan, as a function.
 *
 * The plan lists six hard degradations ("TTS 首包 > 500 ms 且短句切分后仍 > 400 ms
 * 就在 L2 前换引擎", "barge-in 误触发 > 10% 就关自动打断", …). Left as prose,
 * each of them is re-decided by whoever last read the document. Here each rule
 * returns pass / fail / unknown plus the action it implies, so the decision
 * "are we allowed to ship L2" follows from data instead of memory.
 *
 * `unknown` is a first-class result. A missing measurement must not read as
 * "rule not triggered": that is how an unmeasured system gets waved through.
 * `allowL2` is therefore null, not true, whenever a blocking rule lacks data.
 */
import type { SegmentResult } from './report'

export const DEGRADATION_THRESHOLDS = {
  /** §f.3: endpoint + ASR final P50 above this forbids L2 and the "实时对话" wording. */
  endpointPlusAsrP50Ms: 1_000,
  /** §f.3: TTS first packet above this, with the short-sentence value also high, forces an engine swap. */
  ttsFirstPacketP50Ms: 500,
  /** §f.3: the short-sentence check after segmentation. */
  ttsShortSentenceP50Ms: 400,
  bargeInMisTriggerRate: 0.1,
  resayRate: 0.25,
  echoMisTriggerRate: 0.2,
  /** §f.3: context lost across 10 consecutive rounds means summarising every 6. */
  contextLossRound: 10,
  summaryEveryRounds: 6
} as const

export interface RateSample {
  trials: number
  hits: number
}

export function rateOf(sample: RateSample): number | null {
  if (!Number.isInteger(sample.trials) || sample.trials <= 0) return null
  if (!Number.isInteger(sample.hits) || sample.hits < 0) {
    throw new RangeError('hits must be a non-negative integer')
  }
  if (sample.hits > sample.trials) throw new RangeError('hits must not exceed trials')
  return sample.hits / sample.trials
}

export interface RouteEchoSample {
  label: string
  echo: RateSample | null
}

export interface DegradationInput {
  endpoint: SegmentResult
  asrFinal: SegmentResult
  ttsFirstPacket: SegmentResult
  /** Measured after short-sentence segmentation; null when that path was not run. */
  ttsShortSentence?: SegmentResult | null
  bargeIn?: RateSample | null
  resay?: RateSample | null
  /** `maxContinuousRounds` = longest run observed before context visibly broke. */
  context?: { maxContinuousRounds: number; lossObserved: boolean } | null
  routes?: readonly RouteEchoSample[]
}

export type RuleStatus = 'pass' | 'fail' | 'unknown'

export type DegradationAction =
  | 'keep-current'
  | 'l1-only'
  | 'swap-tts-engine'
  | 'disable-auto-barge-in'
  | 'summarize-every-6-rounds'
  | 'force-l1-route'

export interface DegradationDecision {
  ruleId: string
  rule: string
  status: RuleStatus
  action: DegradationAction
  actionLabel: string
  evidence: string
}

export interface DegradationVerdict {
  decisions: DegradationDecision[]
  /** true only when every blocking rule is measured and passing. */
  allowL2: boolean | null
  /** §f.3: no "实时对话" wording unless L2 is actually permitted. */
  realtimeWordingAllowed: boolean
  failingRules: string[]
}

const ACTION_LABELS: Record<DegradationAction, string> = {
  'keep-current': '保持现状',
  'l1-only': '只交 L1（对讲机级），界面禁用「实时对话」措辞',
  'swap-tts-engine': 'L2 之前更换 TTS 引擎',
  'disable-auto-barge-in': '关闭自动打断（改为按键/手动）',
  'summarize-every-6-rounds': '每 6 轮插入一次摘要',
  'force-l1-route': '该路由强制 L1'
}

function p50Of(segment: SegmentResult): number | null {
  return segment.status === 'measured' ? (segment.summary?.p50Ms ?? null) : null
}

function statusLabel(segment: SegmentResult): string {
  return segment.status === 'measured' ? `${p50Of(segment)} ms` : `${segment.status}（${segment.reason ?? '无原因'}）`
}

function decision(
  ruleId: string,
  rule: string,
  status: RuleStatus,
  action: DegradationAction,
  evidence: string
): DegradationDecision {
  return { ruleId, rule, status, action, actionLabel: ACTION_LABELS[action], evidence }
}

function endpointAndAsrDecision(input: DegradationInput): DegradationDecision {
  const threshold = DEGRADATION_THRESHOLDS.endpointPlusAsrP50Ms
  const endpointP50 = p50Of(input.endpoint)
  const asrP50 = p50Of(input.asrFinal)
  if (endpointP50 === null || asrP50 === null) {
    return decision(
      'F1',
      `端点 + ASR 终稿 P50 > ${threshold} ms`,
      'unknown',
      'keep-current',
      `端点 ${statusLabel(input.endpoint)} · ASR 终稿 ${statusLabel(input.asrFinal)} → 无法判定`
    )
  }
  const total = Math.round((endpointP50 + asrP50) * 10) / 10
  return total > threshold
    ? decision(
        'F1',
        `端点 + ASR 终稿 P50 > ${threshold} ms`,
        'fail',
        'l1-only',
        `端点 ${endpointP50} ms + ASR 终稿 ${asrP50} ms = ${total} ms，超出 ${threshold} ms`
      )
    : decision(
        'F1',
        `端点 + ASR 终稿 P50 > ${threshold} ms`,
        'pass',
        'keep-current',
        `端点 ${endpointP50} ms + ASR 终稿 ${asrP50} ms = ${total} ms，在预算内`
      )
}

function ttsDecision(input: DegradationInput): DegradationDecision {
  const threshold = DEGRADATION_THRESHOLDS.ttsFirstPacketP50Ms
  const shortThreshold = DEGRADATION_THRESHOLDS.ttsShortSentenceP50Ms
  const p50 = p50Of(input.ttsFirstPacket)
  if (p50 === null) {
    return decision(
      'F2',
      `TTS 首包 P50 > ${threshold} ms 且短句切分后仍 > ${shortThreshold} ms`,
      'unknown',
      'keep-current',
      `TTS ${statusLabel(input.ttsFirstPacket)} → 无法判定`
    )
  }
  if (p50 <= threshold) {
    return decision(
      'F2',
      `TTS 首包 P50 > ${threshold} ms 且短句切分后仍 > ${shortThreshold} ms`,
      'pass',
      'keep-current',
      `TTS 首包 P50 ${p50} ms，未超过 ${threshold} ms`
    )
  }
  const shortP50 = input.ttsShortSentence ? p50Of(input.ttsShortSentence) : null
  if (shortP50 === null) {
    return decision(
      'F2',
      `TTS 首包 P50 > ${threshold} ms 且短句切分后仍 > ${shortThreshold} ms`,
      'unknown',
      'swap-tts-engine',
      `TTS 首包 P50 ${p50} ms 超标，但短句切分后的数值未测，无法确认是否需要换引擎`
    )
  }
  return shortP50 > shortThreshold
    ? decision(
        'F2',
        `TTS 首包 P50 > ${threshold} ms 且短句切分后仍 > ${shortThreshold} ms`,
        'fail',
        'swap-tts-engine',
        `TTS 首包 P50 ${p50} ms，短句切分后仍 ${shortP50} ms（> ${shortThreshold} ms）`
      )
    : decision(
        'F2',
        `TTS 首包 P50 > ${threshold} ms 且短句切分后仍 > ${shortThreshold} ms`,
        'pass',
        'keep-current',
        `TTS 首包 P50 ${p50} ms 偏高，但短句切分后 ${shortP50} ms，切分这条修好了`
      )
}

function bargeInDecision(input: DegradationInput): DegradationDecision {
  const limit = DEGRADATION_THRESHOLDS.bargeInMisTriggerRate
  const rate = input.bargeIn ? rateOf(input.bargeIn) : null
  if (rate === null) {
    return decision(
      'F3',
      `barge-in 误触发率 > ${(limit * 100).toFixed(0)}%`,
      'unknown',
      'keep-current',
      input.bargeIn ? '误触发样本的 trial 数无效' : '未提供 barge-in 误触发样本'
    )
  }
  const percent = `${(rate * 100).toFixed(1)}%`
  return rate > limit
    ? decision(
        'F3',
        `barge-in 误触发率 > ${(limit * 100).toFixed(0)}%`,
        'fail',
        'disable-auto-barge-in',
        `${percent}（${input.bargeIn?.hits}/${input.bargeIn?.trials}）超出 ${(limit * 100).toFixed(0)}%`
      )
    : decision(
        'F3',
        `barge-in 误触发率 > ${(limit * 100).toFixed(0)}%`,
        'pass',
        'keep-current',
        `${percent}（${input.bargeIn?.hits}/${input.bargeIn?.trials}）在阈值内`
      )
}

function resayDecision(input: DegradationInput): DegradationDecision {
  const limit = DEGRADATION_THRESHOLDS.resayRate
  const rate = input.resay ? rateOf(input.resay) : null
  if (rate === null) {
    return decision(
      'F4',
      `打断后的重述率 > ${(limit * 100).toFixed(0)}%`,
      'unknown',
      'keep-current',
      input.resay ? '重述样本的 trial 数无效' : '未提供重述样本（M6）'
    )
  }
  const percent = `${(rate * 100).toFixed(1)}%`
  return rate > limit
    ? decision(
        'F4',
        `打断后的重述率 > ${(limit * 100).toFixed(0)}%`,
        'fail',
        'l1-only',
        `${percent}（${input.resay?.hits}/${input.resay?.trials}）超出 ${(limit * 100).toFixed(0)}%`
      )
    : decision(
        'F4',
        `打断后的重述率 > ${(limit * 100).toFixed(0)}%`,
        'pass',
        'keep-current',
        `${percent}（${input.resay?.hits}/${input.resay?.trials}）在阈值内`
      )
}

function contextDecision(input: DegradationInput): DegradationDecision {
  const lossRound = DEGRADATION_THRESHOLDS.contextLossRound
  const summaryEvery = DEGRADATION_THRESHOLDS.summaryEveryRounds
  const context = input.context
  if (!context) {
    return decision('F5', `${lossRound} 轮内断上下文`, 'unknown', 'keep-current', '未提供长对话上下文样本（M5）')
  }
  if (!context.lossObserved) {
    return decision(
      'F5',
      `${lossRound} 轮内断上下文`,
      'pass',
      'keep-current',
      `连续 ${context.maxContinuousRounds} 轮未观察到上下文断裂`
    )
  }
  if (context.maxContinuousRounds >= lossRound) {
    return decision(
      'F5',
      `${lossRound} 轮内断上下文`,
      'fail',
      'summarize-every-6-rounds',
      `在第 ${context.maxContinuousRounds} 轮观察到上下文断裂（阈值 ${lossRound}）`
    )
  }
  return decision(
    'F5',
    `${lossRound} 轮内断上下文`,
    'pass',
    'keep-current',
    `虽在第 ${context.maxContinuousRounds} 轮断裂，但早于 ${lossRound} 轮阈值，先按现状观察`,
  )
}

function echoDecision(input: DegradationInput): DegradationDecision {
  const limit = DEGRADATION_THRESHOLDS.echoMisTriggerRate
  const routes = input.routes ?? []
  const measured = routes.filter((route) => route.echo !== null && rateOf(route.echo) !== null)
  if (measured.length === 0) {
    return decision(
      'F6',
      `某路由回声误触发率 > ${(limit * 100).toFixed(0)}%`,
      'unknown',
      'keep-current',
      routes.length === 0 ? '未提供按路由的回声样本（M7）' : '各路由回声样本的 trial 数无效'
    )
  }
  const forced = measured.filter((route) => (rateOf(route.echo as RateSample) ?? 0) > limit)
  const detail = measured
    .map((route) => `${route.label} ${(((rateOf(route.echo as RateSample) ?? 0) * 100)).toFixed(1)}%`)
    .join(' · ')
  if (forced.length > 0) {
    return decision(
      'F6',
      `某路由回声误触发率 > ${(limit * 100).toFixed(0)}%`,
      'fail',
      'force-l1-route',
      `${detail} → 强制 L1：${forced.map((route) => route.label).join(' / ')}`
    )
  }
  const untested = routes.filter((route) => route.echo === null)
  return decision(
    'F6',
    `某路由回声误触发率 > ${(limit * 100).toFixed(0)}%`,
    untested.length > 0 ? 'unknown' : 'pass',
    'keep-current',
    untested.length > 0
      ? `${detail}；未测路由：${untested.map((route) => route.label).join(' / ')}`
      : `${detail} 均在阈值内`
  )
}

/** Rules whose missing data alone is enough to withhold L2. */
const BLOCKING_RULES = ['F1', 'F2', 'F3'] as const

export function evaluateDegradation(input: DegradationInput): DegradationVerdict {
  const decisions = [
    endpointAndAsrDecision(input),
    ttsDecision(input),
    bargeInDecision(input),
    resayDecision(input),
    contextDecision(input),
    echoDecision(input)
  ]
  const failingRules = decisions.filter((entry) => entry.status === 'fail').map((entry) => entry.ruleId)
  const blockingUnknown = decisions.some(
    (entry) => entry.status === 'unknown' && (BLOCKING_RULES as readonly string[]).includes(entry.ruleId)
  )
  const allowL2 = failingRules.length > 0 ? false : blockingUnknown ? null : true
  return {
    decisions,
    allowL2,
    realtimeWordingAllowed: allowL2 === true,
    failingRules
  }
}

function statusCell(status: RuleStatus): string {
  if (status === 'fail') return '触发'
  if (status === 'pass') return '未触发'
  return '未测'
}

export function allowL2Label(allowL2: boolean | null): string {
  if (allowL2 === null) return '未判定（关键规则缺数据）'
  return allowL2 ? '允许进入 L2' : '不允许进入 L2'
}

export function renderDegradationMarkdown(verdict: DegradationVerdict): string {
  const rows = verdict.decisions
    .map(
      (entry) =>
        `| ${entry.ruleId} | ${entry.rule} | ${statusCell(entry.status)} | ${entry.actionLabel} | ${entry.evidence} |`
    )
    .join('\n')
  return `## §f.3 降级门禁

**L2 判定：${allowL2Label(verdict.allowL2)}** · 界面「实时对话」措辞：${verdict.realtimeWordingAllowed ? '允许' : '禁用'}

| 规则 | 触发条件 | 状态 | 应采取的动作 | 依据 |
|---|---|---|---|---|
${rows}

- 「未触发」= 有实测且未超阈值；「未测」不等于未触发，缺数据的规则按保守侧处理。
- §f.3 的六条是硬降级，不是建议：任一条触发即执行对应动作，不按「总体感觉」豁免。
`
}
