## Why

The app quits the moment its only window closes:

```ts
app.on('window-all-closed', () => { app.quit() })   // src/main/index.ts
```

For a dictation tool that is the wrong default. The hotkey, the recorder and the
whole pipeline live in the main process; the window is a settings and history
surface, not the product. A user who presses the red button to get the window
out of the way loses the global hotkey, the recording pill and the LLM sidecar
with it — and nothing on screen explains what happened.

There is also no menu-bar presence today: no `Tray`, and no `setLoginItemSettings`
anywhere in `src/`.

## What Changes

- Closing the main window hides it and keeps the app running: the hotkey, the
  recording pill and the dictation pipeline stay live with no window on screen.
- A menu-bar icon shows the app's state-independent entry points: show or hide
  the window, start or stop dictation, open settings, and quit.
- Quitting becomes explicit — `Cmd+Q`, the Dock, the application menu's 退出, or
  the menu-bar menu. A requested quit is never turned into a hide.
- The application menu replaces Electron's default template, which exposed
  重新加载 and 开发者工具 in a resident app.
- The renderer window is marked `backgroundThrottling: false`, because the
  microphone capture runs in it and a hidden Chromium renderer is throttled by
  default — without the flag, dictation from the menu bar or the hotkey would
  drop audio while the window is closed.
- The packaged app gets a real application icon and the menu-bar template images
  it reads at runtime.

## Capabilities

### New Capabilities

- `menubar-residency`: the window closes without ending the app, and a menu-bar
  icon carries the actions that must survive it.

### Modified Capabilities

- None. `app-shell` describes the window's contents, which do not change.

## Impact

- `src/main/index.ts`: `close` handler, `window-all-closed`, application menu,
  tray wiring, `backgroundThrottling`.
- `src/main/tray.ts` (new): the `Tray`, its template image and menu rendering.
- `src/core/menubar/menu.ts` (new): pure menu model, unit-tested.
- `src/preload/index.ts`, `src/shared/ipc.ts`, `src/renderer/src/App.tsx`: one
  channel so the menu bar's 设置 item can select the settings destination.
- `resources/icon.svg`, `resources/trayTemplate.svg`, built by
  `scripts/build-icons.mjs` into `resources/icon.icns` and the two PNGs.
- `electron-builder.yml`: `mac.icon` and the menu-bar template resources.
- `tests/menubar-menu.test.ts` (new), `tests/packaging.test.ts`.
