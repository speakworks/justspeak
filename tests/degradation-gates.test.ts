import { describe, expect, it } from 'vitest'
import {
  type DegradationInput,
  allowL2Label,
  evaluateDegradation,
  rateOf,
  renderDegradationMarkdown
} from '../scripts/latency-harness/gates'
import { blockedSegment, measuredSegment } from '../scripts/latency-harness/report'

const measured = (value: number) => measuredSegment([value])

function input(overrides: Partial<DegradationInput> = {}): DegradationInput {
  return {
    endpoint: measured(300),
    asrFinal: measured(300),
    ttsFirstPacket: measured(300),
    ttsShortSentence: null,
    bargeIn: null,
    resay: null,
    context: null,
    routes: [],
    ...overrides
  }
}

describe('rateOf', () => {
  it('computes a rate', () => {
    expect(rateOf({ trials: 20, hits: 3 })).toBe(0.15)
  })

  it('returns null for a zero trial count', () => {
    expect(rateOf({ trials: 0, hits: 0 })).toBeNull()
  })

  it('refuses hits above trials', () => {
    expect(() => rateOf({ trials: 2, hits: 3 })).toThrow(/must not exceed/)
  })
})

describe('F1 endpoint + ASR final', () => {
  it('passes inside the 1000 ms budget', () => {
    const decision = evaluateDegradation(input()).decisions[0]
    expect(decision.ruleId).toBe('F1')
    expect(decision.status).toBe('pass')
    expect(decision.evidence).toContain('600 ms')
  })

  it('fails above 1000 ms and demands L1-only', () => {
    const decision = evaluateDegradation(input({ endpoint: measured(700), asrFinal: measured(400) })).decisions[0]
    expect(decision.status).toBe('fail')
    expect(decision.action).toBe('l1-only')
  })

  it('is unknown when either side was not measured', () => {
    const decision = evaluateDegradation(input({ endpoint: blockedSegment('音频不可用') })).decisions[0]
    expect(decision.status).toBe('unknown')
    expect(decision.evidence).toContain('无法判定')
  })
})

describe('F2 TTS first packet', () => {
  it('passes when the first packet is already under 500 ms', () => {
    expect(evaluateDegradation(input()).decisions[1].status).toBe('pass')
  })

  it('is unknown when the first packet is high but the short-sentence value is missing', () => {
    const decision = evaluateDegradation(input({ ttsFirstPacket: measured(700) })).decisions[1]
    expect(decision.status).toBe('unknown')
    expect(decision.action).toBe('swap-tts-engine')
  })

  it('passes when segmentation brought it under 400 ms', () => {
    const decision = evaluateDegradation(
      input({ ttsFirstPacket: measured(700), ttsShortSentence: measured(380) })
    ).decisions[1]
    expect(decision.status).toBe('pass')
    expect(decision.evidence).toContain('切分这条修好了')
  })

  it('fails when it stays above 400 ms after segmentation', () => {
    const decision = evaluateDegradation(
      input({ ttsFirstPacket: measured(700), ttsShortSentence: measured(520) })
    ).decisions[1]
    expect(decision.status).toBe('fail')
    expect(decision.action).toBe('swap-tts-engine')
  })
})

describe('F3 barge-in mis-trigger', () => {
  it('passes at exactly 10% because the rule is "above 10%"', () => {
    const decision = evaluateDegradation(input({ bargeIn: { trials: 20, hits: 2 } })).decisions[2]
    expect(decision.status).toBe('pass')
  })

  it('fails above 10% and disables automatic barge-in', () => {
    const decision = evaluateDegradation(input({ bargeIn: { trials: 20, hits: 3 } })).decisions[2]
    expect(decision.status).toBe('fail')
    expect(decision.action).toBe('disable-auto-barge-in')
  })

  it('is unknown without samples', () => {
    expect(evaluateDegradation(input()).decisions[2].status).toBe('unknown')
  })
})

describe('F4 re-say rate', () => {
  it('fails above 25% and drops to L1', () => {
    const decision = evaluateDegradation(input({ resay: { trials: 20, hits: 6 } })).decisions[3]
    expect(decision.status).toBe('fail')
    expect(decision.action).toBe('l1-only')
  })

  it('passes at 25%', () => {
    expect(evaluateDegradation(input({ resay: { trials: 20, hits: 5 } })).decisions[3].status).toBe('pass')
  })
})

describe('F5 context loss', () => {
  it('is unknown without long-conversation samples', () => {
    expect(evaluateDegradation(input()).decisions[4].status).toBe('unknown')
  })

  it('fails when context broke at round 10 or later', () => {
    const decision = evaluateDegradation(
      input({ context: { maxContinuousRounds: 11, lossObserved: true } })
    ).decisions[4]
    expect(decision.status).toBe('fail')
    expect(decision.action).toBe('summarize-every-6-rounds')
  })

  it('passes when no loss was observed', () => {
    expect(
      evaluateDegradation(input({ context: { maxContinuousRounds: 12, lossObserved: false } })).decisions[4]
        .status
    ).toBe('pass')
  })
})

describe('F6 echo per route', () => {
  it('forces L1 on the route above 20% and leaves the others alone', () => {
    const decision = evaluateDegradation(
      input({
        routes: [
          { label: 'built-in', echo: { trials: 10, hits: 1 } },
          { label: 'bluetooth', echo: { trials: 10, hits: 4 } }
        ]
      })
    ).decisions[5]
    expect(decision.status).toBe('fail')
    expect(decision.action).toBe('force-l1-route')
    expect(decision.evidence).toContain('bluetooth')
    expect(decision.actionLabel).toContain('该路由强制 L1')
  })

  it('is unknown when a route has no echo samples', () => {
    const decision = evaluateDegradation(
      input({ routes: [{ label: 'wired', echo: null }, { label: 'built-in', echo: { trials: 10, hits: 0 } }] })
    ).decisions[5]
    expect(decision.status).toBe('unknown')
    expect(decision.evidence).toContain('未测路由')
  })
})

describe('verdict', () => {
  it('allows L2 only when every blocking rule is measured and passing', () => {
    const verdict = evaluateDegradation(
      input({
        bargeIn: { trials: 10, hits: 0 },
        resay: { trials: 10, hits: 0 },
        context: { maxContinuousRounds: 12, lossObserved: false },
        routes: [
          { label: 'built-in', echo: { trials: 10, hits: 0 } },
          { label: 'wired', echo: { trials: 10, hits: 1 } },
          { label: 'bluetooth', echo: { trials: 10, hits: 0 } }
        ]
      })
    )
    expect(verdict.allowL2).toBe(true)
    expect(verdict.realtimeWordingAllowed).toBe(true)
    expect(verdict.failingRules).toEqual([])
  })

  it('withholds L2 when a rule fails', () => {
    const verdict = evaluateDegradation(input({ bargeIn: { trials: 10, hits: 5 } }))
    expect(verdict.allowL2).toBe(false)
    expect(verdict.realtimeWordingAllowed).toBe(false)
    expect(verdict.failingRules).toContain('F3')
  })

  it('returns null rather than a pass when F1 is unmeasured', () => {
    const verdict = evaluateDegradation(
      input({ asrFinal: blockedSegment('ASR 运行时不存在'), bargeIn: { trials: 10, hits: 0 } })
    )
    expect(verdict.allowL2).toBeNull()
    expect(verdict.realtimeWordingAllowed).toBe(false)
    expect(allowL2Label(verdict.allowL2)).toBe('未判定（关键规则缺数据）')
  })
})

describe('renderDegradationMarkdown', () => {
  it('states the L2 verdict and renders six rules', () => {
    const markdown = renderDegradationMarkdown(evaluateDegradation(input()))
    expect(markdown).toContain('L2 判定：未判定')
    expect(markdown).toContain('| F1 |')
    expect(markdown).toContain('| F6 |')
    expect(markdown).toContain('「未测」不等于未触发')
  })
})
