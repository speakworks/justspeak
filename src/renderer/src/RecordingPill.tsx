import React, { useEffect, useRef, useState } from 'react'
import { PILL_BARS, barScales } from '../../core/overlay/level'
import type { OverlayState } from '../../shared/ipc'

/**
 * The recording pill.
 *
 * It renders in its own window (`?overlay=1`) that floats over every other app,
 * so it must stay tiny, must contain no text, and must never depend on state the
 * main window owns — everything arrives through `onOverlayState`.
 *
 * The bars are animated on their own frame loop: level updates arrive at most 30
 * times a second, and driving `transform: scaleY` from them directly would look
 * stepped. Amplitude still comes from the real level; only the ripple phase runs
 * free, so motion never claims volume that is not there.
 */
export function RecordingPill(): React.JSX.Element {
  const [state, setState] = useState<OverlayState>({ state: 'recording', theme: 'dark' })
  const levelRef = useRef(0)
  const cellsRef = useRef<Array<HTMLSpanElement | null>>([])

  useEffect(() => {
    const offState = window.justspeak.onOverlayState(setState)
    const offLevel = window.justspeak.onOverlayLevel((next) => {
      levelRef.current = next
    })
    // Tell main we are mounted: it retains the state and pushes it on this
    // signal, which is what makes the very first recording after launch visible.
    window.justspeak.overlayReady()
    return () => {
      offState()
      offLevel()
    }
  }, [])

  useEffect(() => {
    let frame = 0
    let phase = 0
    let last = 0
    const tick = (now: number): void => {
      // ~60 fps, independent of how often the level arrives.
      if (now - last >= 16) {
        last = now
        phase += 0.06
        const scales = barScales(levelRef.current, phase, PILL_BARS)
        for (let i = 0; i < scales.length; i += 1) {
          const cell = cellsRef.current[i]
          if (cell) cell.style.transform = `scaleY(${scales[i].toFixed(3)})`
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  const recording = state.state === 'recording'

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
        {Array.from({ length: PILL_BARS }, (_, index) => (
          <span
            key={index}
            ref={(node) => {
              cellsRef.current[index] = node
            }}
          />
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
