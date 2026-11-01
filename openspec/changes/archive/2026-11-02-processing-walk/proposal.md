## Why

The recording pill kept its waveform moving while transcribing, which falsely
suggested the microphone was still live. Replacing the waveform with a separate
Thinking + progress surface was worse: local recognition often finishes in a few
hundred milliseconds, so the new UI flashed and disappeared mid-animation.

The approved direction is to reuse the waveform itself. The pill already renders
17 bars; in the working state those same 17 elements freeze at the resting
(horizontal-line) geometry and only change colour. One lit bar walks left to
right; reaching the last bar is the completion signal. Recording (continuous,
level-driven) and working (discrete, colour-driven) look clearly different while
sharing the same DOM, layout, and window.

## What Changes

- Working state reuses the 17 recording bars at the exact resting size; no shape,
  size, text, progress number, or window change.
- The bars change colour only: pending, passed, active. The active bar hops 4 px
  and advances one bar every 110 ms (90 ms hop, 20 ms hold).
- Reaching the last bar means complete. If delivery arrives before the walk
  finishes, the highlight jumps directly to the last bar; the pill then hides.
  If the walk reaches the last bar first, it waits there until delivery.
- A test-only `JUSTSPEAK_FAKE_DELAY_MS` keeps the fake provider's working state
  open long enough for E2E; production paths ignore it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `recording-indicator`: the working form reuses the recording bars and uses a
  colour walk instead of a live level or a separate progress surface.

## Impact

- `src/core/overlay/walk.ts`, `src/core/overlay/level.ts` (bar count reuse),
  `src/renderer/src/RecordingPill.tsx`, `src/renderer/src/styles.css`,
  `src/main/overlay.ts`, `src/main/index.ts`, `src/shared/ipc.ts`,
  `src/preload/index.ts`.
- No new window or DOM track; the pill stays 132×38 and non-activating.
