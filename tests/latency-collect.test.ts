import { describe, expect, it } from 'vitest'
import {
  type CollectRow,
  aggregateColumns,
  buildRow,
  buildTable,
  coverageOf,
  discoverRecordings,
  parseRecordingFileName,
  parseRouteList,
  recordingFileName
} from '../scripts/latency-harness/collect'
import { blockedSegment, measuredSegment } from '../scripts/latency-harness/report'

const measured = (value: number) => measuredSegment([value])

function row(recId: string, route: 'built-in' | 'wired' | 'bluetooth', values: [number, number, number, number]): CollectRow {
  return buildRow(recId, route, {
    endpoint: measured(values[0]),
    asrFinal: measured(values[1]),
    llmFirstToken: measured(values[2]),
    ttsFirstPacket: measured(values[3])
  })
}

describe('parseRecordingFileName', () => {
  it('accepts the canonical name', () => {
    expect(parseRecordingFileName('rec-01.wav')).toEqual({
      recId: 'rec-01',
      index: 1,
      fileName: 'rec-01.wav'
    })
  })

  it('accepts upper case and keeps the recId canonical', () => {
    expect(parseRecordingFileName('REC-20.WAV')?.recId).toBe('rec-20')
  })

  it('rejects a single-digit index', () => {
    expect(parseRecordingFileName('rec-1.wav')).toBeNull()
  })

  it('rejects unrelated names', () => {
    expect(parseRecordingFileName('zh-4s.wav')).toBeNull()
    expect(parseRecordingFileName('rec-01.m4a')).toBeNull()
    expect(parseRecordingFileName('notes.txt')).toBeNull()
  })
})

describe('discoverRecordings', () => {
  it('sorts by index and reports every missing segment', () => {
    const result = discoverRecordings(['rec-03.wav', 'rec-01.wav', 'README.md'])
    expect(result.recordings.map((entry) => entry.recId)).toEqual(['rec-01', 'rec-03'])
    expect(result.problems.filter((problem) => problem.startsWith('缺失'))).toHaveLength(18)
  })

  it('flags a non-canonical wav instead of silently dropping it', () => {
    const result = discoverRecordings(['recording-01.wav'])
    expect(result.recordings).toEqual([])
    expect(result.problems[0]).toContain('命名不合规')
  })

  it('flags an out-of-range segment', () => {
    const result = discoverRecordings(['rec-21.wav'])
    expect(result.problems[0]).toContain('超出 Phase 0 范围')
  })

  it('keeps the first file when two names collide on the same index', () => {
    const result = discoverRecordings(['rec-01.wav', 'REC-01.WAV'])
    expect(result.recordings).toHaveLength(1)
    expect(result.problems.some((problem) => problem.includes('段号重复'))).toBe(true)
  })

  it('reports no gap when all 20 are present', () => {
    const names = Array.from({ length: 20 }, (_, index) => recordingFileName(index + 1))
    const result = discoverRecordings(names)
    expect(result.recordings).toHaveLength(20)
    expect(result.problems).toEqual([])
  })
})

describe('parseRouteList', () => {
  it('accepts the three declared routes', () => {
    expect(parseRouteList('built-in,wired,bluetooth')).toEqual(['built-in', 'wired', 'bluetooth'])
  })

  it('deduplicates repeated routes', () => {
    expect(parseRouteList('wired,wired')).toEqual(['wired'])
  })

  it('rejects an unknown label', () => {
    expect(() => parseRouteList('built-in,airplay')).toThrow(/未知路由/)
  })

  it('rejects an empty list', () => {
    expect(() => parseRouteList(' , ')).toThrow(/至少需要一条路由/)
  })
})

describe('buildRow', () => {
  it('sums the four P50s into M1 when every column was measured', () => {
    const built = row('rec-01', 'built-in', [400, 300, 200, 500])
    expect(built.m1.status).toBe('measured')
    expect(built.m1.summary?.p50Ms).toBe(1400)
    expect(built.m1.detail.note).toContain('不是真人听感的 M1')
  })

  it('refuses to synthesise M1 when any column is blocked', () => {
    const built = buildRow('rec-02', 'wired', {
      endpoint: measured(400),
      asrFinal: blockedSegment('ASR 运行时不存在'),
      llmFirstToken: measured(200),
      ttsFirstPacket: measured(500)
    })
    expect(built.m1.status).toBe('blocked')
    expect(built.m1.reason).toContain('ASR 运行时不存在')
  })
})

describe('buildTable', () => {
  it('always renders the full 20 × 3 grid', () => {
    const table = buildTable([])
    expect(table.split('\n')).toHaveLength(60)
    expect(table.split('\n')[0]).toBe('| rec-01 | built-in | 待填 | 待填 | 待填 | 待填 | 待填 |')
    expect(table.split('\n')[59]).toBe('| rec-20 | bluetooth | 待填 | 待填 | 待填 | 待填 | 待填 |')
  })

  it('puts blocked in the cell instead of a number', () => {
    const one = buildRow('rec-01', 'built-in', {
      endpoint: measured(412),
      asrFinal: blockedSegment('ASR 模型不存在'),
      llmFirstToken: measured(180),
      ttsFirstPacket: measured(510)
    })
    const line = buildTable([one]).split('\n')[0]
    expect(line).toBe('| rec-01 | built-in | 412 | blocked | 180 | 510 | blocked |')
  })

  it('renders M1 only when the row measured all four columns', () => {
    const complete = row('rec-01', 'wired', [400, 300, 200, 500])
    const line = buildTable([complete]).split('\n')[1]
    expect(line).toBe('| rec-01 | wired | 400 | 300 | 200 | 500 | 1400 |')
  })
})

describe('coverageOf', () => {
  it('counts measured, blocked and missing cells separately', () => {
    const rows = [
      row('rec-01', 'built-in', [400, 300, 200, 500]),
      buildRow('rec-02', 'built-in', {
        endpoint: measured(400),
        asrFinal: measured(300),
        llmFirstToken: blockedSegment('模型缺失'),
        ttsFirstPacket: measured(500)
      })
    ]
    const coverage = coverageOf(rows)
    expect(coverage.gridRows).toBe(60)
    expect(coverage.rows).toBe(2)
    expect(coverage.measuredColumns).toBe(7)
    expect(coverage.blockedColumns).toBe(1)
    expect(coverage.missingRows).toBe(58)
    expect(coverage.complete).toBe(false)
  })

  it('is complete only when every cell was measured', () => {
    const rows: CollectRow[] = []
    const routes = ['built-in', 'wired', 'bluetooth'] as const
    for (let index = 1; index <= 20; index += 1) {
      const recId = recordingFileName(index).slice(0, -4)
      for (const route of routes) rows.push(row(recId, route, [400, 300, 200, 500]))
    }
    expect(coverageOf(rows).complete).toBe(true)
  })
})

describe('aggregateColumns', () => {
  it('pools samples across rows so the gate reads one P50', () => {
    const rows = [row('rec-01', 'built-in', [400, 300, 200, 500]), row('rec-02', 'built-in', [500, 400, 300, 600])]
    const pooled = aggregateColumns(rows)
    expect(pooled.endpoint.summary?.p50Ms).toBe(450)
    expect(pooled.ttsFirstPacket.summary?.p50Ms).toBe(550)
    expect(pooled.endpoint.detail.measuredRows).toBe(2)
  })

  it('keeps a fully blocked column blocked with its first reason', () => {
    const rows = [
      buildRow('rec-01', 'built-in', {
        endpoint: blockedSegment('音频不可用'),
        asrFinal: blockedSegment('ASR 运行时不存在'),
        llmFirstToken: blockedSegment('模型缺失'),
        ttsFirstPacket: blockedSegment('voices=0')
      })
    ]
    const pooled = aggregateColumns(rows)
    expect(pooled.endpoint.status).toBe('blocked')
    expect(pooled.endpoint.reason).toBe('音频不可用')
    expect(pooled.asrFinal.reason).toBe('ASR 运行时不存在')
  })

  it('returns blocked, not zero, for an empty row list', () => {
    const pooled = aggregateColumns([])
    expect(pooled.endpoint.status).toBe('blocked')
    expect(pooled.endpoint.summary).toBeNull()
  })
})
