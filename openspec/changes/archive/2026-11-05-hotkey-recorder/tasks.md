## 1. Pure capture mapping

- [x] 1.1 Add `captureHotkey` with physical-key mapping, pending modifier preview, bare-Escape cancel, modifier-less rejection, and a macOS-reserved denylist; verify the accept/reject table in `tests/hotkey-capture.test.ts`.
- [x] 1.2 Add `modifierDisplayParts` and reuse `parseAccelerator` as the only validator, so a captured chord can never be one the typed path would reject.

## 2. Capture lifecycle in main

- [x] 2.1 Add `hotkey:capture-start` with the trusted-sender and idle-session checks; unregister the dictation key so the chord reaches the renderer.
- [x] 2.2 Add `hotkey:capture-end` restoring the previous binding, with a 15 s safety timeout that pushes `hotkey:capture-ended` and a refreshed preferences view.
- [x] 2.3 Treat a successful apply as the end of capture: clear the timer and let the new registration supersede the temporary unregistration.

## 3. Renderer

- [x] 3.1 Replace the typed input and apply button with `HotkeyRecorder`; show keycaps while idle, held modifiers while pending, and Esc/blur cancellation.
- [x] 3.2 Keep one feedback surface: capture hints and main results share the existing hotkey message row.
- [x] 3.3 Cancel a capture when the settings page is left, and unstuck the control on `hotkey:capture-ended`.

## 4. Verification and delivery

- [x] 4.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `openspec validate --specs --strict`.
- [x] 4.2 Verify the recorder in a running Electron app with `tests/e2e/hotkey-recorder.spec.ts`: record a new chord, cancel with Escape, confirm the old binding stays live, and check the modifier-less hint; the dev app was relaunched for the owner's manual key check.
