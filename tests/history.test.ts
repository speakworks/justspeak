import { describe, expect, it } from 'vitest'
import {
  formatHistoryDuration,
  formatHistoryTime,
  groupHistoryByDate,
  localDateKey,
  localDateLabel,
  parseHistory,
  parseHistoryLine,
  planHistoryRetention,
  removeHistoryEntry,
  serializeHistoryEntry
} from '../src/core/history'
import type { HistoryEntry } from '../src/shared/ipc'

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'e1',
    text: '你好',
    createdAt: new Date(2026, 10, 1, 12, 0, 0).getTime(),
    outcome: 'pasted',
    fake: false,
    durationMs: 1200,
    latencyMs: 300,
    ...overrides
  }
}

describe('history serialization', () => {
  it('round-trips an entry through one JSON line', () => {
    const value = entry()
    const line = serializeHistoryEntry(value)
    expect(line.endsWith('\n')).toBe(true)
    expect(line.trim().split('\n')).toHaveLength(1)
    expect(parseHistoryLine(line)).toEqual(value)
  })

  it('keeps a transcript containing newlines on a single physical line', () => {
    const value = entry({ text: '第一段\n\n第二段' })
    const line = serializeHistoryEntry(value)
    expect(line.split('\n')).toHaveLength(2)
    expect(parseHistoryLine(line)?.text).toBe('第一段\n\n第二段')
  })

  it('parses the optional audio reference and ignores unknown keys', () => {
    const line = JSON.stringify({
      ...entry({ audio: { file: 'audio/e1.wav', bytes: 2048 } }),
      futureField: true
    })
    expect(parseHistoryLine(line)?.audio).toEqual({ file: 'audio/e1.wav', bytes: 2048 })
  })

  it('rejects malformed or incomplete lines instead of throwing', () => {
    expect(parseHistoryLine('{not json')).toBeNull()
    expect(parseHistoryLine('[]')).toBeNull()
    expect(parseHistoryLine('')).toBeNull()
    expect(parseHistoryLine(JSON.stringify({ ...entry(), outcome: 'unknown' }))).toBeNull()
    expect(parseHistoryLine(JSON.stringify({ ...entry(), durationMs: 'long' }))).toBeNull()
    // A timestamp `Date` cannot represent would crash the row renderer.
    expect(parseHistoryLine(JSON.stringify({ ...entry(), createdAt: 1e20 }))).toBeNull()
  })

  it('counts unusable lines and keeps the rest of the file', () => {
    const raw = [
      serializeHistoryEntry(entry({ id: 'a' })),
      '{broken',
      serializeHistoryEntry(entry({ id: 'b' }))
    ].join('\n')
    const parsed = parseHistory(raw)
    expect(parsed.entries.map((value) => value.id)).toEqual(['a', 'b'])
    expect(parsed.skipped).toBe(1)
  })
})

describe('history grouping', () => {
  const now = new Date(2026, 10, 1, 12, 0, 0).getTime()

  it('uses local calendar dates', () => {
    const createdAt = new Date(2026, 9, 31, 23, 30).getTime()
    expect(localDateKey(createdAt)).toBe('2026-10-31')
  })

  it('labels today, yesterday and older days', () => {
    expect(localDateLabel(new Date(2026, 10, 1, 8).getTime(), now)).toBe('今天')
    expect(localDateLabel(new Date(2026, 9, 31, 23).getTime(), now)).toBe('昨天')
    expect(localDateLabel(new Date(2026, 9, 30, 10).getTime(), now)).toBe('2026年10月30日')
  })

  it('orders entries newest first and groups by day', () => {
    const groups = groupHistoryByDate(
      [
        entry({ id: 'old', createdAt: new Date(2026, 9, 30, 9).getTime() }),
        entry({ id: 'late', createdAt: new Date(2026, 10, 1, 11).getTime() }),
        entry({ id: 'early', createdAt: new Date(2026, 10, 1, 8).getTime() })
      ],
      now
    )
    expect(groups.map((group) => group.label)).toEqual(['今天', '2026年10月30日'])
    expect(groups[0]?.entries.map((value) => value.id)).toEqual(['late', 'early'])
    expect(groups[1]?.entries.map((value) => value.id)).toEqual(['old'])
  })

  it('returns no groups for an empty history', () => {
    expect(groupHistoryByDate([], now)).toEqual([])
  })

  it('formats a row time and duration', () => {
    expect(formatHistoryTime(new Date(2026, 10, 1, 9, 5).getTime())).toBe('09:05')
    expect(formatHistoryDuration(3200)).toBe('3.2s')
  })
})

describe('history retention', () => {
  const now = new Date(2026, 10, 1, 12, 0, 0).getTime()
  const limits = { maxEntries: 2, maxAgeMs: 30 * 86_400_000, maxAudioEntries: 1 }

  it('keeps the newest entries and drops the overflow', () => {
    const plan = planHistoryRetention(
      [
        entry({ id: 'new', createdAt: now }),
        entry({ id: 'mid', createdAt: now - 1000 }),
        entry({ id: 'old', createdAt: now - 2000 })
      ],
      now,
      limits
    )
    expect(plan.kept.map((value) => value.id)).toEqual(['new', 'mid'])
    expect(plan.removed.map((value) => value.id)).toEqual(['old'])
  })

  it('drops entries older than the age window even when under the count cap', () => {
    const plan = planHistoryRetention(
      [entry({ id: 'stale', createdAt: now - 31 * 86_400_000 })],
      now,
      limits
    )
    expect(plan.kept).toEqual([])
    expect(plan.removed.map((value) => value.id)).toEqual(['stale'])
  })

  it('drops audio past the audio cap but keeps the text row', () => {
    const audio = { file: 'audio/a.wav', bytes: 100 }
    const plan = planHistoryRetention(
      [
        entry({ id: 'newest', createdAt: now, audio }),
        entry({ id: 'older', createdAt: now - 1000, audio: { ...audio, file: 'audio/b.wav' } })
      ],
      now,
      limits
    )
    expect(plan.kept.map((value) => value.id)).toEqual(['newest', 'older'])
    expect(plan.kept[0]?.audio).toEqual(audio)
    expect(plan.kept[1]?.audio).toBeUndefined()
    expect(plan.audioDropped).toEqual([{ file: 'audio/b.wav', bytes: 100 }])
    expect(plan.removed).toEqual([])
  })

  it('reports nothing to do for an empty history', () => {
    expect(planHistoryRetention([], now, limits)).toEqual({
      kept: [],
      removed: [],
      audioDropped: []
    })
  })

  it('applies the count cap by position even when ids repeat', () => {
    const plan = planHistoryRetention(
      [
        entry({ id: 'same', createdAt: now }),
        entry({ id: 'same', createdAt: now - 1000 }),
        entry({ id: 'same', createdAt: now - 2000 })
      ],
      now,
      { ...limits, maxEntries: 1 }
    )
    expect(plan.kept).toHaveLength(1)
    expect(plan.removed).toHaveLength(2)
  })
})

describe('history removal', () => {
  it('drops only the requested id', () => {
    const entries = [entry({ id: 'a' }), entry({ id: 'b' })]
    expect(removeHistoryEntry(entries, 'a').map((value) => value.id)).toEqual(['b'])
    expect(removeHistoryEntry(entries, 'missing')).toHaveLength(2)
  })
})
