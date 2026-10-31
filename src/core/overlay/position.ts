/**
 * Where the recording pill sits.
 *
 * Pure so it can be unit-tested without a screen: main feeds it the display's
 * work area (which already excludes the Dock and menu bar) and gets back the
 * window bounds. Anchoring to the work area rather than the physical screen is
 * what makes the pill track a moving or hidden Dock.
 */

export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface IndicatorBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Window size in logical points; the pill inside is smaller. */
export const INDICATOR_WIDTH = 256
export const INDICATOR_HEIGHT = 56

/** Gap above the work-area bottom edge, matching what Handy uses on macOS. */
export const INDICATOR_BOTTOM_INSET = 15

export function indicatorBounds(workArea: WorkArea): IndicatorBounds {
  const x = workArea.x + Math.round((workArea.width - INDICATOR_WIDTH) / 2)
  const preferredY = workArea.y + workArea.height - INDICATOR_HEIGHT - INDICATOR_BOTTOM_INSET
  return {
    x,
    y: Math.max(workArea.y, preferredY),
    width: INDICATOR_WIDTH,
    height: INDICATOR_HEIGHT
  }
}
