import React, { useEffect, useState } from 'react'
import { barHeights } from '../../core/overlay/level'
import type { OverlayState } from '../../shared/ipc'

/**
 * The recording pill.
 *
 * It renders in its own window (`?overlay=1`) that floats over every other app,
 * so it must stay tiny, must contain no text, and must never depend on state
 * the main window owns — everything arrives through `onOverlayState`.
 */

export function RecordingPill(): React.JSX.Element {
  const [state, setState] = useState<OverlayState>({ state: 'recording', theme: 'dark' })
  const [level, setLevel] = useState(0)

  useEffect(() => {
    const offState = window.justspeak.onOverlayState(setState)
    const offLevel = window.justspeak.onOverlayLevel(setLevel)
    // Tell main we are mounted: it retains the state and pushes it on this
    // signal, which is what makes the very first recording after launch visible.
    window.justspeak.overlayReady()
    return () => {
      offState()
      offLevel()
    }
  }, [])

  const recording = state.state === 'recording'
  const heights = barHeights(recording ? level : 0.35)

  return (
    <div className={`pill pill-${state.theme} ${recording ? 'is-recording' : 'is-working'}`}>
      {recording ? (
        <button
          type="button"
          className="pill-btn pill-cancel"
          aria-label="取消"
          onClick={() => window.justspeak.cancelRecording()}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      ) : (
        <span className="pill-dot" aria-hidden="true" />
      )}

      <div className="pill-bars" aria-hidden="true">
        {heights.map((height, index) => (
          <span key={index} style={{ height: `${height}%` }} />
        ))}
      </div>

      {recording ? (
        <button
          type="button"
          className="pill-btn pill-finish"
          aria-label="完成"
          onClick={() => window.justspeak.finishRecording()}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 8.5l3 3 6-6.5" />
          </svg>
        </button>
      ) : (
        <span className="pill-dot" aria-hidden="true" />
      )}
    </div>
  )
}
