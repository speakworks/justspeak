## Context

`settings-surface` already owns the single preferences path: `preferences:get` /
`preferences:set`, backed by a merged `userData/preferences.json`, with honest
`default` / `override` / `unavailable` labels produced by
`src/core/preferences/view.ts`. `app-shell` owns the window, sidebar and
first-launch lifecycle. Electron's `app.getLoginItemSettings` /
`app.setLoginItemSettings` are the only supported macOS login-item APIs here.

## Goals / Non-Goals

### Goals

- One settings row whose value is the OS's answer, not a cached boolean.
- First-run default on, applied once, idempotent on later launches.
- Honest unavailable/failure reporting on unsupported or unsigned builds.
- Pure decision logic in `src/core`, Electron calls only in `src/main`.

### Non-Goals

- New IPC channels or a second persistence file.
- `openAsHidden`, `wasOpenedAtLogin`, or login-item service management.
- Windows/Linux support.
- Retrying a refused setting on every launch.

## Decisions

### 1. Reuse the preferences surface instead of a new IPC channel

`PreferencesView` grows a `loginItem` field and `PreferencesPatch` accepts
`launchAtLogin`. This keeps one renderer copy, uses the existing trusted-sender
check, and reuses the merge-on-write store. A dedicated `autostart:*` channel
would duplicate validation and lifecycle without buying anything.

### 2. The view carries the system state; preferences only carry the choice marker

`preferences.json` gains an optional `launchAtLogin: boolean`. Its only job is
to distinguish "the user (or the first-run default) has already decided" from
"no decision yet". The row renders `getLoginItemSettings().openAtLogin`, so a
manual change in 系统设置 → 通用 → 登录项 is reflected after the next
preferences read.

### 3. Read back after writing, and never trust the requested value

The main-process adapter calls `setLoginItemSettings`, then calls
`getLoginItemSettings` again. Success requires the read-back to equal the
requested value. A mismatch (common for an unsigned build or a bundle outside
`/Applications`) returns `ok: false` with a message; the UI re-renders from the
fresh view. A missing API or a thrown read returns `available: false`, which the
pure view maps to `unavailable` with a reason.

### 4. First run seeds on; later runs leave the system alone

At startup:

- `launchAtLogin === undefined` (missing key): call `setLoginItemSettings({ openAtLogin: true })`,
  then persist the read-back value. Repeating this call with a stored value is
  a no-op, so the seeding is idempotent.
- `launchAtLogin` present: do not call the OS. The user may have disabled the
  item in System Settings; forcing it back on would override their choice.

An explicit settings toggle always applies immediately and persists the
accepted read-back value.

### 5. Honest labels

Built-in default is on, so:

- `openAtLogin === true` → `default` (登录时自动启动).
- `openAtLogin === false` → `override` (已关闭), with a hint that System
  Settings is where it can be re-enabled.
- `available === false` → `unavailable` with the read/set failure reason.

## macOS limitations (documented in the spec and PR)

- An unsigned development build, or a bundle not placed in `/Applications`, may
  fail to register; macOS can also hide it from the login-item list. The row
  reports the OS's answer (`off`) and a refused toggle names the likely cause.
- Disabling the item in 系统设置 → 通用 → 登录项 is reflected as `off` in the
  app after the next preferences read; the app does not fight the user.
- macOS 13+ deprecated/ignored the legacy `openAsHidden` field, and Electron 45
  has removed it from the API. This change never referenced it, so the app
  launches with its normal window behaviour.
