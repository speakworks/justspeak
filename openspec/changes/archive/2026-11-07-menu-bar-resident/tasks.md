## 1. Close means hide

- [x] 1.1 Track an explicit `quitting` flag and derive the window's `close` behaviour from it, so a requested quit is never turned into a hide.
- [x] 1.2 Stop quitting in `window-all-closed`; refresh the tray instead.
- [x] 1.3 Add `showMainWindow()` that recreates, restores and focuses the window from any state the menu bar can leave it in.
- [x] 1.4 Mark the window `backgroundThrottling: false`, because the microphone capture runs in the hidden renderer.

## 2. Menu-bar icon

- [x] 2.1 Model the menu in `src/core/menubar/menu.ts`, with the dictation item derived from the session state and the window item from visibility.
- [x] 2.2 Create the `Tray` once, load the template image and mark it `setTemplateImage(true)`, and rebuild the menu only when its rendered content changes.
- [x] 2.3 Refresh the tray from the single state funnel (`sendState`), from window show/hide/minimize/restore, and from every hotkey change.
- [x] 2.4 Route the 设置 item through a new `menu:navigate` channel so the renderer selects the settings destination.

## 3. Application menu and icons

- [x] 3.1 Replace Electron's default menu, which exposed 重新加载 and 开发者工具 in a resident app.
- [x] 3.2 Draw the icon and the menu-bar mark as SVG sources and build `icon.icns` plus the two template PNGs with `scripts/build-icons.mjs`.
- [x] 3.3 Set `mac.icon` and copy both template PNGs into the bundle.

## 4. Verification and delivery

- [x] 4.1 Unit-test the menu model and the close decision, including that no session state drops an item.
- [x] 4.2 Guard the icon wiring in `tests/packaging.test.ts`.
- [x] 4.3 Drive the real Electron app: closing hides instead of destroying, the hidden renderer still captures and delivers away from itself, the Dock's `activate` restores the window, and an explicit quit exits.
- [x] 4.4 Confirm the template image loads as a real `NativeImage` that reports `isTemplateImage()` (guarded by `tests/e2e/resident.spec.ts`).
- [x] 4.5 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm exec playwright test`, and `openspec validate --specs --strict`.
- [x] 4.6 Mutation-test the guards: removing `preventDefault`, the `before-quit` flag, `backgroundThrottling: false`, or the `activate` handler each fails a named test.
- [x] 4.7 Address the review findings: dock-click startup race, 隐藏主窗口 wiring, tray-click focus theft, stale menu accelerator, and an audio-flow-proving hidden-capture test.
- [ ] 4.8 Archive the change before merging and pin the merge to the reviewed tip.
