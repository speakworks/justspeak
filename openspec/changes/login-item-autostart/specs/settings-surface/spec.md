## ADDED Requirements

### Requirement: Autostart SHALL report the OS login-item state

The settings surface SHALL render an 开机自动启动 row whose switch value comes
from `app.getLoginItemSettings().openAtLogin` on every preferences read. The row
SHALL NOT display a value cached in `preferences.json`. It SHALL use the existing
honest labels: `default` when the system reports the app opens at login (the
built-in default is on), `override` when the system reports it off, and
`unavailable` with a reason when the login-item API is missing or the read
throws. Toggling SHALL call `app.setLoginItemSettings({ openAtLogin })` and then
re-read the system; the UI SHALL adopt the read-back value, and a value the
system did not accept SHALL be reported as a failure instead of being displayed
as applied.

#### Scenario: External disable is reflected

- **WHEN** the user turns the app's login item off in 系统设置 → 通用 → 登录项
  and then refreshes the settings surface
- **THEN** the in-app 开机自动启动 switch shows off
- **AND** the row is labelled 已修改 (`override`)

#### Scenario: Read-back wins over the request

- **WHEN** the user toggles 开机自动启动
- **THEN** main calls `setLoginItemSettings` with the requested boolean and then
  calls `getLoginItemSettings`
- **AND** the row renders the value from that read, not the requested value

#### Scenario: The login-item API is unavailable

- **WHEN** `getLoginItemSettings` is missing or throws
- **THEN** the row is labelled 不可用 (`unavailable`) with the reason
- **AND** its switch is disabled rather than shown as off

#### Scenario: A refused change is not claimed as applied

- **WHEN** `getLoginItemSettings` still reports the previous value after
  `setLoginItemSettings` (for example in an unsigned build)
- **THEN** the write result is a failure with a message naming the likely cause
- **AND** the switch reflects the value the system actually reports
