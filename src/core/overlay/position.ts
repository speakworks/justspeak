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

/**
 * Window size in logical points — deliberately tight around the pill.
 *
 * A transparent Electron window still receives mouse events over its invisible
 * area, so a window much larger than the pill would leave a dead zone that
 * swallows clicks meant for whatever is behind it.
 */
export const INDICATOR_WIDTH = 132
export const INDICATOR_HEIGHT = 38

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

/**
 * The copy panel: same horizontal anchor as the pill, sitting just above the
 * spot the pill occupied. A fixed height with internal scrolling is deliberate
 * — a window whose bounds change with the transcript would jump around while
 * the user is reading it.
 */
export const RESULT_PANEL_WIDTH = 420
export const RESULT_PANEL_HEIGHT = 220
export const RESULT_PANEL_BOTTOM_INSET = 64

export function resultPanelBounds(workArea: WorkArea): IndicatorBounds {
  // Keep the panel inside the work area even on a display narrower than the
  // preferred width; a 240 px floor would push it off-screen below ~272 px.
  const width = Math.min(RESULT_PANEL_WIDTH, Math.max(1, workArea.width - 32))
  const x = workArea.x + Math.round((workArea.width - width) / 2)
  const preferredY = workArea.y + workArea.height - RESULT_PANEL_HEIGHT - RESULT_PANEL_BOTTOM_INSET
  return {
    x,
    y: Math.max(workArea.y, preferredY),
    width,
    height: RESULT_PANEL_HEIGHT
  }
}
