/**
 * Microphone level for the pill, computed where the audio already is.
 *
 * Main receives every `capture:pcm` batch, so it can derive the level without a
 * renderer-to-renderer hop. Two pieces are pure and tested: the RMS of a batch,
 * and the throttle that keeps the push under 30 messages per second (34 ms, not
 * 33: a 33 ms interval admits 31 pushes in a rolling second).
 */

const FULL_SCALE = 32768
export const LEVEL_INTERVAL_MS = 34

/** Root-mean-square of 16-bit PCM, normalised to 0..1 of full scale. */
export function rmsOf(samples: Int16Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] / FULL_SCALE
    sum += value * value
  }
  return Math.sqrt(sum / samples.length)
}

export interface LevelThrottle {
  /** True when a level may be pushed at `nowMs`; records the send when it does. */
  shouldSend(nowMs: number): boolean
  reset(): void
}

export function createLevelThrottle(intervalMs: number = LEVEL_INTERVAL_MS): LevelThrottle {
  let last = Number.NEGATIVE_INFINITY
  return {
    shouldSend(nowMs: number): boolean {
      if (nowMs - last < intervalMs) return false
      last = nowMs
      return true
    },
    reset(): void {
      last = Number.NEGATIVE_INFINITY
    }
  }
}

/** One cell per bar; thin and close together so the cluster reads as a voice print. */
export const PILL_BARS = 21

/** Resting scale: 18 px cell * 0.11 ≈ 2 px, so silence looks like a dashed line. */
export const PILL_BAR_REST_SCALE = 0.11

/**
 * Vertical scale for each bar, 0..1, centre-anchored.
 *
 * The envelope (a bell across the row) is what makes the cluster read as a
 * waveform instead of a bar chart; the ripple keeps it alive between level
 * updates without inventing volume — amplitude still comes from the real RMS.
 */
export function barScales(
  level: number,
  phase: number,
  count: number = PILL_BARS
): number[] {
  const gain = Math.min(1, Math.max(0, level) * 8) * 1.9
  const scales: number[] = []
  for (let i = 0; i < count; i += 1) {
    const envelope = 0.34 + 0.66 * Math.sin((Math.PI * (i + 0.5)) / count)
    const ripple = 0.74 + 0.26 * Math.sin(i * 0.55 + phase)
    scales.push(Math.max(PILL_BAR_REST_SCALE, Math.min(1, gain * envelope * ripple)))
  }
  return scales
}
