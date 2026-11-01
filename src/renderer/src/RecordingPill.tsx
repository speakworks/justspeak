import React, { useEffect, useRef, useState } from 'react'
import { PILL_BARS, barScales } from '../../core/overlay/level'
import {
  WALK_LAST_INDEX,
  WALK_STEP_MS,
  advanceWalk,
  completeWalk,
  walkPhase
} from '../../core/overlay/walk'
import type { OverlayState } from '../../shared/ipc'

/**
 * The recording pill.
 *
 * It renders in its own window (`?overlay=1`) that floats over every other app,
 * so it must stay tiny, must contain no text, and must never depend on state the
 * main window owns — everything arrives through `onOverlayState`.
 *
 * Recording: the 17 bars follow the live level on their own frame loop. Working:
 * the same 17 bars freeze at the resting scale and only change colour; a lit bar
 * walks right, one step every `WALK_STEP_MS`. Completing the walk (or delivery
 * arriving first) puts the highlight on the last bar.
 */
export function RecordingPill(): React.JSX.Element {
  const [state, setState] = useState<OverlayState>({ state: 'recording', theme: 'dark' })
  const [walk, setWalk] = useState(0)
  const levelRef = useRef(0)
  const cellsRef = useRef<Array<HTMLSpanElement | null>>([])
  const recordingRef = useRef(true)
  const walkCompleteRef = useRef(false)

  useEffect(() => {
    const offState = window.justspeak.onOverlayState(setState)
    const offLevel = window.justspeak.onOverlayLevel((next) => {
      levelRef.current = next
    })
    const offComplete = window.justspeak.onOverlayComplete(() => {
      walkCompleteRef.current = true
      setWalk(completeWalk())
    })
    // Tell main we are mounted: it retains the state and pushes it on this
    // signal, which is what makes the very first recording after launch visible.
    window.justspeak.overlayReady()
    return () => {
      offState()
      offLevel()
      offComplete()
    }
  }, [])

  useEffect(() => {
    // The overlay window shares styles.css with the main window but never mounts
    // App; without this the light pill would keep the dark theme's accent and the
    // walk would be nearly invisible on its near-white background.
    document.documentElement.dataset.theme = state.theme
    const recording = state.state === 'recording'
    recordingRef.current = recording
    if (!recording) {
      // The bars switch to the working geometry; drop the live-level transforms
      // so the CSS resting scale is what the colour walk starts from.
      for (const cell of cellsRef.current) {
        if (cell) cell.style.transform = ''
      }
    }
  }, [state.state, state.theme])

  useEffect(() => {
    if (state.state !== 'working') return
    walkCompleteRef.current = false
    setWalk(0)
    let index = 0
    let timer = 0
    const tick = (): void => {
      if (walkCompleteRef.current) return
      index = advanceWalk(index)
      setWalk(index)
      if (index < WALK_LAST_INDEX) {
        timer = window.setTimeout(tick, WALK_STEP_MS)
      }
    }
    timer = window.setTimeout(tick, WALK_STEP_MS)
    return () => window.clearTimeout(timer)
  }, [state.state])

  useEffect(() => {
    let frame = 0
    let phase = 0
    let last = 0
    const tick = (now: number): void => {
      // ~60 fps, independent of how often the level arrives.
      if (recordingRef.current && now - last >= 16) {
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

  const working = state.state === 'working'

  return (
    <div
      className={`pill pill-${state.theme} ${working ? 'is-working' : 'is-recording'}`}
      role={working ? 'status' : undefined}
      aria-label={working ? '正在把语音转换为文字' : undefined}
    >
      {working ? null : (
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
      )}

      <div className="pill-bars" aria-hidden="true">
        {Array.from({ length: PILL_BARS }, (_, index) => {
          const phase = working ? walkPhase(index, walk) : 'pending'
          return (
            <span
              key={index}
              className={phase === 'pending' ? undefined : phase}
              ref={(node) => {
                cellsRef.current[index] = node
              }}
            />
          )
        })}
      </div>

      {working ? null : (
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
      )}
    </div>
  )
}
