## ADDED Requirements

### Requirement: First launch SHALL enable autostart once without overriding a stored choice

On the first launch, when `preferences.json` has no `launchAtLogin` key, the app
SHALL apply the built-in default `openAtLogin: true` through the OS login-item
API and SHALL persist `launchAtLogin` with the value the system reports back.
On every later launch, when the key exists, the app SHALL NOT call
`setLoginItemSettings`, so a login item the user disabled in System Settings
stays disabled. An explicit settings toggle SHALL take effect on the same launch
and SHALL persist the accepted read-back value. The seeding step SHALL be
idempotent: repeating it with a stored choice SHALL make no OS call and write
nothing.

#### Scenario: First launch applies the default

- **WHEN** the app starts and `preferences.json` has no `launchAtLogin` key
- **THEN** it calls `setLoginItemSettings({ openAtLogin: true })` once
- **AND** it stores the value subsequently reported by `getLoginItemSettings`

#### Scenario: A stored choice is never overwritten

- **WHEN** `launchAtLogin` is already present, whether true or false
- **THEN** startup makes no `setLoginItemSettings` call
- **AND** it does not rewrite the stored value

#### Scenario: An external disable survives a restart

- **WHEN** the user disabled the login item in System Settings while
  `launchAtLogin` is true in `preferences.json`
- **THEN** the next launch leaves the system setting disabled
- **AND** the settings row reads the system's off state

#### Scenario: Explicit toggle on the same launch

- **WHEN** the user changes 开机自动启动 while the app is running
- **THEN** the OS call happens immediately, the read-back is verified, and the
  accepted value is persisted for later launches
