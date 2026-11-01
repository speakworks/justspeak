import { PILL_BARS } from './level'

/**
 * The working-state walk across the recording pill's bars.
 *
 * The pill reuses the same `PILL_BARS` spans it uses for the waveform. In the
 * working state their geometry is frozen at the resting scale; only colour and
 * the active index change. One highlight walks left to right; reaching the last
 * bar is the completion signal.
 */

/** 90 ms hop + 20 ms landing hold; slow enough to read, fast enough to finish. */
export const WALK_STEP_MS = 110

/** Reaching this bar means the transcript has been delivered. */
export const WALK_LAST_INDEX = PILL_BARS - 1

export type WalkPhase = 'pending' | 'passed' | 'active'

export function walkPhase(index: number, activeIndex: number): WalkPhase {
  if (index < activeIndex) return 'passed'
  if (index === activeIndex) return 'active'
  return 'pending'
}

/** One step right, clamped at the last bar. */
export function advanceWalk(index: number): number {
  return Math.min(WALK_LAST_INDEX, Math.max(0, index + 1))
}

/** The final jump used when the result arrives before the walk finishes. */
export function completeWalk(): number {
  return WALK_LAST_INDEX
}
