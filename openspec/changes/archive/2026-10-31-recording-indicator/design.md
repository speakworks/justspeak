## Context

The session already broadcasts every state change through one funnel
(`sendState` in `src/main/index.ts`), and main already receives the renderer's
audio in `capture:pcm`. The indicator therefore needs no new plumbing for state
or level — only a second window, a small handshake, and one cancellation
transition.

## Considered solutions

| # | Approach | Pros | Cons | Verdict |
|---|----------|------|------|---------|
| A | Second `BrowserWindow` loading the existing renderer bundle with `?overlay=1` | Reuses preload, IPC, styles and the React build; no new build entry | The renderer bundle boots twice | **Chosen** |
| B | Separate `overlay.html` renderer entry via electron-vite multi-entry | Cleaner isolation | Build-config change, a second preload, duplicated styles | Rejected: more moving parts for a 40 px pill |
| C | `WebContentsView` attached to the main window | No second window | The main window is exactly what must stay out of the way; a child view cannot float over other apps | Rejected: does not solve the problem |
| D | Native overlay in a helper process (Tauri-style) | Lowest memory | Requires a second runtime in an Electron app | Rejected: none of the latency budget is here |

## Decision

**A.** One overlay window, created lazily and **destroyed when the main window
closes** (so `window-all-closed` keeps its current meaning and the app still
quits when the user closes the window).

Window options, matching the main window's security posture:

- `type: 'panel'`, `focusable: false`, `frame: false`, `transparent: true`,
  `hasShadow: false`, `skipTaskbar: true`, `resizable: false`, `show: false`.
- `webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false }`
  — without `preload` the pill has no `window.justspeak` at all.
- `setAlwaysOnTop(true, 'status')` and
  `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`.
- The same `setWindowOpenHandler(() => ({ action: 'deny' }))` and an
  allowlist `will-navigate` guard the main window carries.
- Position from `screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea`:
  horizontally centred, `workArea.y + workArea.height - height - 15`.
- Size 256×56 logical; the pill is 172–216×40 with a 24 px radius.
- Loading mirrors the main window: `ELECTRON_RENDERER_URL + '?overlay=1'` in dev,
  `loadFile(out/renderer/index.html, { search: 'overlay=1' })` otherwise, with a
  `did-fail-load` handler that logs and hides rather than leaving an invisible
  window alive.

**Handshake (the race the first design missed).** Main retains the current
overlay state; the overlay sends `overlay:ready` after it mounts and main
re-pushes the retained state. Main also re-pushes on `did-finish-load`. Without
this the first recording after launch pushes `overlay:state` before the
preload's listeners exist and the pill never appears for that session.

**State.** `sendState()` decides the overlay state — `recording` → pill,
`transcribing`/`pasting` → working form, `idle`/`error` → hide after a 200 ms
fade. A pending hide timer SHALL be cancelled whenever the overlay is shown
again, so a cancel followed immediately by a new recording cannot be hidden by
the stale timer.

**Theme.** The resolved theme (`light`/`dark`) travels in the `overlay:state`
payload, so the pill follows the app's pinned appearance instead of re-deriving
it. The overlay cannot call `preferences:get` — those handlers are gated to the
main window's sender.

**Level.** Computed in main from each `capture:pcm` batch (RMS of the Int16
samples, mapped through the same 0–1 curve the renderer uses), throttled to one
message per **34 ms** (≥34 ms is what makes "no more than 30 in any one second"
true; a 33 ms interval allows 31).

**Cancel.** `SessionController.cancel()` returns `'cancel'` only from
`recording`, moving to `idle` with a notice; main discards the PCM buffer and
stops the renderer's capture. The renderer's later `capture:stopped` is already
ignored as stale, so cancellation reuses that rule instead of adding a parallel
one. Cancelling while `transcribing`/`pasting` is ignored — the same choice
VoiceInk makes.

**Overlay-originated IPC.** `overlay:cancel` and `overlay:finish` are accepted
**only from the overlay window's webContents id**. They are not left ungated
like `recording:toggle`, because they mutate a session. `overlay:finish` acts
only while the session is `recording`; called from `idle` it would otherwise
*start* a recording, since `toggle()` is a toggle.

## Risks

| Risk | Mitigation |
|------|------------|
| Clicking the pill steals focus and breaks paste-into-target-app | Probe measured clicks landing with `document.hasFocus()` false; a task re-checks it by typing into the target app after clicking |
| Full-screen apps or another space still hide it | `visibleOnAllWorkspaces(..., { visibleOnFullScreen: true })`; verified by hand in a task |
| The shared bundle paints an opaque page under `transparent: true` | `?overlay=1` branch sets `html, body { background: transparent }` and drops the page gradients; a task checks the screenshot has no box |
| Closing the main window stops quitting the app | The overlay is destroyed on the main window's `closed` event |
| Level IPC flooding | Throttled to one message per 34 ms in main |
