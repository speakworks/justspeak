# login-item-autostart Tasks

## 1. OpenSpec

- [x] 1.1 `proposal.md` records the motivation, default-on goal, risks, and non-goals
- [x] 1.2 `specs/settings-surface/spec.md` adds the honest autostart row contract
- [x] 1.3 `specs/app-shell/spec.md` adds the first-launch seeding contract
- [x] 1.4 `design.md` records the preferences-surface, read-back, and macOS decisions

## 2. Pure logic (src/core)

- [x] 2.1 `src/core/preferences/autostart.ts`: `LoginItemView`, `planStartupAutostart`,
      `resolveAutostartWrite` — decisions only, no Electron import
- [x] 2.2 `src/core/preferences/merge.ts`: optional `launchAtLogin` in the stored
      shape, writable keys, validation, and merge-on-write
- [x] 2.3 `src/core/preferences/view.ts`: `describeAutostart` mapping the system
      state to default / override / unavailable, included in `buildSettingsRows`

## 3. Main wiring

- [x] 3.1 `src/main/login-item.ts`: adapter over `app.getLoginItemSettings` /
      `app.setLoginItemSettings`, with set-then-read-back and thrown-read handling
- [x] 3.2 `src/main/index.ts`: first-launch seeding in `whenReady`, `loginItem` in
      `readPreferencesView`, and `launchAtLogin` handling in `preferences:set`

## 4. Shared types and preload

- [x] 4.1 `src/shared/ipc.ts`: `LoginItemView`, `PreferencesView.loginItem`,
      `PreferencesPatch.launchAtLogin`
- [x] 4.2 No new IPC channel: the preload surface is unchanged

## 5. Renderer

- [x] 5.1 `SettingsPanel.tsx`: 开机自动启动 row with the read-back value, honest
      chip, disabled switch when unavailable
- [x] 5.2 `App.tsx`: toggle writes through `preferences:set`

## 6. Tests

- [x] 6.1 Read-back true / false from a mocked Electron `app.getLoginItemSettings`
- [x] 6.2 Toggle calls `setLoginItemSettings` with the right argument and then re-reads
- [x] 6.3 Thrown read / thrown write → unavailable or failure, never a crash or a fake success
- [x] 6.4 First-run seeds the default; a stored choice is not overwritten; merge validates the key
- [x] 6.5 View labels: on → default, off → override, failed read → unavailable

## 7. Verification

- [x] 7.1 `pnpm exec vitest run` (805 passed / 4 skipped baseline, only grow)
- [x] 7.2 `pnpm typecheck`
- [x] 7.3 `pnpm build`
- [x] 7.4 `openspec validate --specs --strict` and
      `openspec validate login-item-autostart --strict`

## 8. Delivery

- [x] 8.1 Commit, push `feat/login-item-autostart`, open a PR against `main`
      (no merge)
