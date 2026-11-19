import type { TranscriptSegmentMeta } from '../asr/types'

/**
 * `m:ss` for one segment duration. Whole seconds are rounded; a negative or
 * non-finite value clamps to `0:00` rather than producing a broken label.
 */
export function formatSegmentDuration(durationMs: number): string {
  const totalSeconds = Number.isFinite(durationMs)
    ? Math.max(0, Math.round(durationMs / 1000))
    : 0
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * The panel's one-line segmentation summary, e.g. `3 段 · 0:12 / 0:18 / 0:09`.
 * Returns `undefined` when there is nothing to disclose, so the panel renders
 * no empty line for a one-shot or single-segment result.
 */
export function formatSegmentLine(
  segments: readonly TranscriptSegmentMeta[] | undefined
): string | undefined {
  if (segments === undefined || segments.length === 0) return undefined
  const durations = segments.map((segment) => formatSegmentDuration(segment.durationMs))
  return `${segments.length} 段 · ${durations.join(' / ')}`
}
