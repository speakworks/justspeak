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

/** Relative bar heights so the waveform reads as a waveform, not a solid block. */
const BAR_WEIGHTS = [0.45, 0.75, 1, 0.65, 0.9, 0.55, 0.8, 1, 0.5]

/**
 * Bar heights (percent) for a 0..1 RMS level.
 *
 * The main window paints its level bar at `level * 800` percent, so a full
 * 0..1 fraction is `level * 8` here — using `level * 800` as a fraction would
 * amplify ambient noise a hundredfold and pin every bar at 100%.
 */
export function barHeights(level: number, weights: number[] = BAR_WEIGHTS): number[] {
  const gain = Math.min(1, Math.max(0, level) * 8)
  return weights.map((weight, index) => {
    // A resting sliver keeps the pill from looking dead before audio arrives.
    const raised = Math.max(0.18, gain * weight)
    const jitter = index % 2 === 0 ? 1 : 0.82
    return Math.round(Math.min(1, raised * jitter) * 100)
  })
}
