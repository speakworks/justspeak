/**
 * Pure statistics for the SpeakPilot latency harness.
 *
 * Nothing here touches the clock, the filesystem, or a model. The harness
 * decides what to sample; this module only turns samples into numbers a
 * reader can act on, so the arithmetic itself can be tested in CI without any
 * of the hardware the harness needs.
 *
 * Percentiles use linear interpolation (the "R-7"/Excel default method) over
 * the sorted sample. With 20 samples P95 sits between the 19th and 20th
 * observation, so it is never smaller than the 19th and never larger than the
 * maximum; that is deliberate. We do not round samples into buckets, because a
 * 12 ms difference is the whole gap between "passes §f.1" and "misses it".
 */

export interface LatencySummary {
  count: number
  minMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  meanMs: number
}

/** p must be in (0, 1]. Returns null for an empty sample rather than 0. */
export function percentile(samples: readonly number[], p: number): number | null {
  if (!Number.isFinite(p) || p <= 0 || p > 1) {
    throw new RangeError(`percentile p must be in (0, 1], received ${p}`)
  }
  if (samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]
  const rank = (sorted.length - 1) * p
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (lower === upper) return sorted[lower]
  const weight = rank - lower
  return sorted[lower] + weight * (sorted[upper] - sorted[lower])
}

/** Rounds to `decimals`, avoiding the trailing-digit noise of interpolation. */
export function roundTo(value: number, decimals = 1): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Returns null for an empty sample: an absent measurement is not a zero. */
export function summarize(samples: readonly number[], decimals = 1): LatencySummary | null {
  if (samples.length === 0) return null
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  const mean = samples.reduce((total, value) => total + value, 0) / samples.length
  return {
    count: samples.length,
    minMs: roundTo(min, decimals),
    p50Ms: roundTo(percentile(samples, 0.5) as number, decimals),
    p95Ms: roundTo(percentile(samples, 0.95) as number, decimals),
    maxMs: roundTo(max, decimals),
    meanMs: roundTo(mean, decimals)
  }
}

/** True / false when a summary exists, null when the segment was not measured. */
export function meetsThreshold(
  summary: LatencySummary | null,
  thresholdMs: number,
  percentileKey: 'p50Ms' | 'p95Ms' = 'p50Ms'
): boolean | null {
  if (summary === null) return null
  return summary[percentileKey] <= thresholdMs
}
