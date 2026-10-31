## 1. Session cancellation (test-first)

- [x] 1.1 Failing unit test: `SessionController.cancel()` returns `'cancel'` from `recording` and moves to `idle`; returns `'ignore'` from `idle`, `transcribing`, `pasting`
- [x] 1.2 Implement `cancel()` in `src/core/session/session-controller.ts`
- [x] 1.3 Test: a `capture:stopped` arriving after cancellation is ignored (stale-stop rule)

## 2. Overlay window (main process)

- [x] 2.1 Pure position helper `src/core/overlay/position.ts` + unit test (bottom-centre, 15 pt inset, arbitrary display work area)
- [x] 2.2 Pure throttle helper for the level push + unit test proving ≤30 messages in any rolling second
- [x] 2.3 `src/main/overlay.ts`: lazy window with the design's options, preload parity, window-open/`will-navigate` guards, dev-URL and `loadFile(..., { search })` branches, `did-fail-load` handler
- [x] 2.4 `overlay:state` push with retained state, `overlay:ready` handshake and `did-finish-load` re-push; hide timer cancelled on every show; destroy on the main window's `closed`
- [x] 2.5 Wire `sendState()` to the overlay state mapping (theme token included) and `capture:pcm` to the throttled RMS push

## 3. Overlay UI and IPC

- [x] 3.1 `src/renderer/src/main.tsx`: when `location.search` contains `overlay=1`, render the pill component **instead of** `<App/>` (never mount App in the overlay: it would start a second capture)
- [x] 3.2 Pill component: ✕ / waveform / ✓, no text nodes, transparent page background override so the window shows only the pill
- [x] 3.3 Preload additions: `onOverlayState`, `onOverlayLevel`, `overlayReady`, `cancelRecording`, `finishRecording`
- [x] 3.4 Main IPC handlers `overlay:cancel` and `overlay:finish`, gated to the overlay's webContents id; `finish` acts only while `recording`; both discard the PCM buffer and stop the renderer's capture

## 4. Verification

- [x] 4.1 `pnpm typecheck`, `pnpm test`, `pnpm build`, `openspec validate --strict`
- [x] 4.2 Real app: record from an editor, screenshot the pill (no opaque box), confirm the frontmost app never changes
- [ ] 4.2b Real app: repeat 4.2 with a full-screen frontmost app and from a second Space (needs a human at the machine; no synthetic full-screen app available)
- [x] 4.3 Click ✕ (invoked through the same API the button calls): no transcript, session back to `idle`, `document.hasFocus()` false throughout
- [ ] 4.3b Real app: after clicking ✕ or ✓ with the mouse, type into the target editor and confirm the keystrokes land there (needs Accessibility permission for synthetic input)
- [x] 4.4 Close the main window and confirm the app still quits (overlay destroyed)
- [x] 4.5 Confirm the first recording after a fresh launch shows the pill (handshake, not only later recordings)
