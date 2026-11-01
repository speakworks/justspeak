## 1. Working walk (pure, test-first)

- [x] 1.1 `walkPhase` / `advanceWalk` / `completeWalk` with the bar count borrowed from `PILL_BARS`
- [x] 1.2 Tests for passed / active / pending, clamping, and completion

## 2. Renderer

- [x] 2.1 Working state keeps the same 17 bars at the resting geometry; only colour changes
- [x] 2.2 Active bar hops 4 px; steps every 90 + 20 ms
- [x] 2.3 No text, no buttons, no width change; recording keeps the live waveform
- [x] 2.4 Reduced motion disables the hop, not the colour walk

## 3. Completion signal

- [x] 3.1 `overlay:complete` sent only when the working pill is visible
- [x] 3.2 Completion jumps the highlight to the last bar; slow delivery waits there
- [x] 3.3 Cancellations and startup idles only hide the pill

## 4. Verification

- [x] 4.1 `pnpm typecheck`, `pnpm test`, `pnpm build`, `openspec validate --specs --strict`
- [x] 4.2 E2E: recording bars, working colour walk, last-bar completion, unchanged 132 px width
- [x] 4.3 Full Electron E2E suite green
