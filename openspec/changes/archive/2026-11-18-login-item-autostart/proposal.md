## Why

The app is a menu-bar resident dictation tool, but it still has to be launched by
hand after every reboot. `docs/AI-HANDOFF.md` records this as an open product
gap: the repository has no `setLoginItemSettings` call at all, so the
"always available" promise of the menu-bar design stops at the next restart.

macOS already owns the source of truth for login items. Storing a boolean in
`preferences.json` and painting it back would drift the moment the user disables
the item in 系统设置 → 通用 → 登录项, so the feature has to read the OS state
rather than remember it.

## What Changes

- **Default on**: on the first launch, when `preferences.json` carries no
  `launchAtLogin` key, the app applies the built-in default
  `openAtLogin: true` once and records the system's read-back value. Later
  launches never re-apply it, so a manual disable in System Settings sticks.
- **One honest settings row**: the settings surface gains an 开机自动启动 row.
  Its switch value is read from `app.getLoginItemSettings().openAtLogin` on every
  preferences read. A toggle calls `app.setLoginItemSettings({ openAtLogin })`
  and then re-reads; the row adopts the read-back value. A refused change is
  reported as a failure, never as applied.
- **Unavailable is a real state**: when the login-item API is missing or the
  read throws, the row reports `unavailable` with a reason and disables the
  switch instead of pretending the setting is off.
- **One surface**: the toggle travels on the existing `preferences:get` /
  `preferences:set` IPC. No new channel and no second persisted truth.

## Goals

- Autostart works on a packaged macOS build with no user setup.
- The in-app switch matches what macOS reports, including changes made outside
  the app.
- `preferences.json` remains a merged store: the new key does not disturb any
  existing key, and an absent key is distinguishable from `false`.

## Non-Goals

- Windows/Linux autostart (the product is macOS-only).
- Hiding the window on login (`openAsHidden`); the app keeps its existing
  menu-bar/window behaviour.
- A separate autostart IPC channel, a helper daemon, or `LaunchAgents` plists.
- Re-applying the stored choice on every startup when macOS refused it.

## Risks

- **Unsigned or non-`/Applications` builds**: macOS may silently refuse the
  login item. The row will show the OS's answer (`off`) and the failed toggle
  message instead of claiming success; this is documented in the spec and PR.
- **User disables it in System Settings**: the row must read `off` on the next
  refresh. Covered by the read-back contract.
- **API surface drift**: Electron exposes `openAtLogin` for macOS; the adapter
  treats a missing function or a thrown read as `unavailable`, so an API change
  downgrades the row instead of crashing startup.
