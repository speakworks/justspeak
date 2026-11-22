import { describe, expect, it } from 'vitest'
import { meetsThreshold, percentile, summarize } from '../scripts/latency-harness/stats'
import {
  type HarnessInput,
  blockedSegment,
  buildReport,
  classifyTtsProbe,
  evaluateGates,
  measuredSegment,
  renderMarkdown,
  renderPhase0Template,
  skippedSegment
} from '../scripts/latency-harness/report'

function input(overrides: Partial<HarnessInput> = {}): HarnessInput {
  return {
    gitCommit: '3ecf132',
    appVersion: '0.1.0-demo.2',
    generatedAt: '2026-11-22T04:36:00.000Z',
    hardware: {
      chip: 'Apple M1 Max',
      cores: 10,
      memoryBytes: 34_359_738_368,
      macOS: '27.0.1',
      powerState: 'AC Power'
    },
    route: { label: 'built-in', outputDevice: '内置扬声器', screenLocked: false },
    llm: { binaryPath: null, modelPath: null, modelId: null, streaming: 'not-run' },
    segments: {
      asrFinal: blockedSegment('模型缺失'),
      llmFirstToken: blockedSegment('模型缺失'),
      ttsFirstPacket: blockedSegment('无音频设备')
    },
    ...overrides
  }
}

describe('percentile', () => {
  it('returns the only sample for n=1', () => {
    expect(percentile([420], 0.5)).toBe(420)
    expect(percentile([420], 0.95)).toBe(420)
  })

  it('interpolates between neighbours instead of snapping to a bucket', () => {
    expect(percentile([100, 200], 0.5)).toBe(150)
    expect(percentile([100, 200], 0.95)).toBe(195)
  })

  it('keeps p95 between the second-largest and the largest sample', () => {
    const samples = [572, 610, 655, 700, 820]
    const p95 = percentile(samples, 0.95) as number
    expect(p95).toBeGreaterThan(700)
    expect(p95).toBeLessThan(820)
    expect(p95).toBeCloseTo(796, 6)
  })

  it('is monotonic in p', () => {
    const samples = [1, 9, 4, 22, 17, 30, 2]
    const p50 = percentile(samples, 0.5) as number
    const p95 = percentile(samples, 0.95) as number
    expect(p95).toBeGreaterThanOrEqual(p50)
  })

  it('does not mutate the caller sample', () => {
    const samples = [3, 1, 2]
    percentile(samples, 0.5)
    expect(samples).toEqual([3, 1, 2])
  })

  it('returns null for an empty sample and rejects invalid p', () => {
    expect(percentile([], 0.5)).toBeNull()
    expect(() => percentile([1], 0)).toThrow(RangeError)
    expect(() => percentile([1], 1.2)).toThrow(RangeError)
  })
})

describe('summarize', () => {
  it('reports null for an empty sample rather than zeros', () => {
    expect(summarize([])).toBeNull()
  })

  it('fills min / p50 / p95 / max / mean for the committed 5-sample shape', () => {
    const summary = summarize([572, 610, 655, 700, 820])
    expect(summary).toEqual({
      count: 5,
      minMs: 572,
      p50Ms: 655,
      p95Ms: 796,
      maxMs: 820,
      meanMs: 671.4
    })
  })

  it('thresholds return null when nothing was measured', () => {
    expect(meetsThreshold(null, 500)).toBeNull()
    expect(meetsThreshold(summarize([400]), 500)).toBe(true)
    expect(meetsThreshold(summarize([620]), 500)).toBe(false)
  })
})

describe('segment constructors', () => {
  it('refuses to record a measured segment with no samples', () => {
    expect(() => measuredSegment([])).toThrow(/at least one sample/)
  })

  it('refuses blocked / skipped segments without a reason', () => {
    expect(() => blockedSegment('')).toThrow(/reason/)
    expect(() => skippedSegment('   ')).toThrow(/reason/)
  })
})

describe('buildReport', () => {
  it('derives a date-commit-route runId', () => {
    const report = buildReport(input())
    expect(report.runId).toBe('2026-11-22-3ecf132-built-in')
    expect(report.kind).toBe('speakpilot-latency-harness')
  })

  it('leaves every gate null when all three segments are blocked', () => {
    const report = buildReport(input())
    expect(report.gates).toEqual({
      ttsFirstPacketP50Under500ms: null,
      ttsFirstPacketP50Under400ms: null,
      asrFinalP50Under1000ms: null,
      llmFirstTokenP50Under150ms: null,
      phase0TableComplete: false
    })
  })

  it('judges gates from real samples only', () => {
    const gates = evaluateGates(
      {
        asrFinal: measuredSegment([900, 950, 1_100]),
        llmFirstToken: measuredSegment([120, 140, 160]),
        ttsFirstPacket: measuredSegment([610, 700, 820])
      },
      { recordings: 0, routes: 1 }
    )
    expect(gates.asrFinalP50Under1000ms).toBe(true)
    expect(gates.llmFirstTokenP50Under150ms).toBe(true)
    expect(gates.ttsFirstPacketP50Under500ms).toBe(false)
    expect(gates.ttsFirstPacketP50Under400ms).toBe(false)
    expect(gates.phase0TableComplete).toBe(false)
  })

  it('only completes the phase 0 gate at 20 recordings across 3 routes', () => {
    const segments = {
      asrFinal: measuredSegment([500]),
      llmFirstToken: measuredSegment([200]),
      ttsFirstPacket: measuredSegment([600])
    }
    expect(evaluateGates(segments, { recordings: 20, routes: 2 }).phase0TableComplete).toBe(false)
    expect(evaluateGates(segments, { recordings: 19, routes: 3 }).phase0TableComplete).toBe(false)
    expect(evaluateGates(segments, { recordings: 20, routes: 3 }).phase0TableComplete).toBe(true)
  })

  it('rejects a hand-built input that lies about status', () => {
    const broken = input()
    broken.segments.ttsFirstPacket = {
      status: 'blocked',
      reason: '  ',
      samplesMs: [],
      summary: null,
      detail: {}
    }
    expect(() => buildReport(broken)).toThrow(/reason/)
  })
})

describe('classifyTtsProbe', () => {
  it('refuses to call a voiceless run measured', () => {
    const segment = classifyTtsProbe({ startMs: [478, 155, 1], voiceCount: 0 }, 3)
    expect(segment.status).toBe('blocked')
    expect(segment.reason).toContain('voices=0')
    expect(segment.samplesMs).toEqual([])
  })

  it('rejects an implausibly fast first packet as a silent no-op', () => {
    const segment = classifyTtsProbe({ startMs: [1, 2, 3], voiceCount: 2 }, 3)
    expect(segment.status).toBe('blocked')
    expect(segment.detail.rejectedP50Ms).toBe(2)
  })

  it('blocks on a probe timeout even when other samples exist', () => {
    const segment = classifyTtsProbe(
      { startMs: [600, 640], errors: ['timeout'], voiceCount: 2 },
      3
    )
    expect(segment.status).toBe('blocked')
    expect(segment.reason).toContain('超时')
  })

  it('measures a plausible run and keeps the boundary numbers apart', () => {
    const segment = classifyTtsProbe(
      { startMs: [572, 610, 820], boundaryMs: [700, 780], voiceCount: 2, zhVoice: 'Tingting' },
      3
    )
    expect(segment.status).toBe('measured')
    expect(segment.summary?.p50Ms).toBe(610)
    expect(segment.detail.boundaryP50Ms).toBe(740)
    expect(segment.detail.requestedSamples).toBe(3)
  })
})

describe('renderMarkdown', () => {
  it('shows blocked segments as blocked, never as 0 ms', () => {
    const markdown = renderMarkdown(buildReport(input()))
    expect(markdown).toContain('blocked')
    expect(markdown).toContain('未测')
    expect(markdown).not.toMatch(/blocked[^\n]*\| 0 \|/)
  })

  it('prints measured P50 / P95 and the commit', () => {
    const report = buildReport(
      input({
        segments: {
          asrFinal: measuredSegment([420]),
          llmFirstToken: blockedSegment('模型缺失'),
          ttsFirstPacket: measuredSegment([610, 700, 820])
        }
      })
    )
    const markdown = renderMarkdown(report)
    expect(markdown).toContain('实测 3 次')
    expect(markdown).toContain('3ecf132')
    expect(markdown).toContain('未测')
  })
})

describe('renderPhase0Template', () => {
  it('ships one blank row per recording × route and no prefilled number', () => {
    const template = renderPhase0Template()
    expect(template).toContain('rec-01')
    expect(template).toContain('rec-20')
    expect(template).toContain('bluetooth')
    const rows = template.split('\n').filter((line) => line.startsWith('| rec-'))
    expect(rows).toHaveLength(60)
    expect(rows.every((row) => row.includes('待填'))).toBe(true)
  })
})
