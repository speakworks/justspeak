import { describe, expect, it } from 'vitest'
import { formatSegmentDuration, formatSegmentLine } from '../src/core/panel/segments'
import type { TranscriptSegmentMeta } from '../src/shared/ipc'

const segment = (index: number, durationMs: number): TranscriptSegmentMeta => ({
  index,
  startMs: 0,
  durationMs
})

describe('segment duration formatting', () => {
  it('formats zero and sub-second values as 0:00', () => {
    expect(formatSegmentDuration(0)).toBe('0:00')
    expect(formatSegmentDuration(499)).toBe('0:00')
  })

  it('rounds to whole seconds', () => {
    expect(formatSegmentDuration(500)).toBe('0:01')
    expect(formatSegmentDuration(12_400)).toBe('0:12')
  })

  it('formats more than a minute as m:ss with a padded seconds field', () => {
    expect(formatSegmentDuration(65_000)).toBe('1:05')
    expect(formatSegmentDuration(600_000)).toBe('10:00')
  })

  it('clamps negative and non-finite values instead of breaking the label', () => {
    expect(formatSegmentDuration(-1)).toBe('0:00')
    expect(formatSegmentDuration(Number.NaN)).toBe('0:00')
  })
})

describe('panel segment line', () => {
  it('joins every duration with the documented separator', () => {
    expect(
      formatSegmentLine([segment(0, 12_000), segment(1, 18_000), segment(2, 9_000)])
    ).toBe('3 段 · 0:12 / 0:18 / 0:09')
  })

  it('returns undefined when there is nothing to disclose', () => {
    expect(formatSegmentLine(undefined)).toBeUndefined()
    expect(formatSegmentLine([])).toBeUndefined()
  })
})
