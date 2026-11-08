## ADDED Requirements

### Requirement: Update checks SHALL follow an explicit user policy

The app SHALL NOT contact the update feed by default. Settings SHALL offer a
检查更新 action (manual check) and an 自动检查更新 toggle that is **off** by
default. When the toggle is on, the app MAY check at most once per day: on
startup (delayed so it does not slow the first run) and every 24 hours after.

Every check SHALL query only the fixed feed `https://github.com/speakworks/justspeak/releases`
and SHALL send no user content, identifier, or telemetry — only the request the
HTTP GET itself carries. The feed URL SHALL NOT be user-configurable.

A check that finds a newer version SHALL ask the user before downloading. It
SHALL NOT download or install silently. The update check SHALL be disclosed as
a network destination in the user-facing documentation.

#### Scenario: Default is no network contact

- **WHEN** the app starts with the 自动检查更新 toggle off (the default)
- **THEN** no request is sent to the update feed

#### Scenario: The user opens settings and checks manually

- **WHEN** the user clicks 检查更新
- **THEN** the app queries the feed once and reports the result
  （已是最新版本 / 发现新版本 vX.Y.Z 并询问是否下载 / 检查失败原因）

#### Scenario: A newer version is found

- **WHEN** a check returns a version newer than the running one
- **THEN** the app asks the user whether to download and install
- **AND** does not download until the user confirms

### Requirement: Unsigned builds SHALL state that auto-update needs the signed build

A build whose bundle is not signed with a Developer ID certificate SHALL report
检查更新 results honestly: 检查更新 in such a build SHALL return the message
「自动更新需要正式签名版」, and the automatic check SHALL NOT run in it. The
build SHALL NOT pretend to have checked, and SHALL NOT offer a fake
"newer version found".

#### Scenario: 检查更新 in an unsigned build

- **WHEN** the running app bundle is signed ad-hoc or unsigned
- **AND** the user clicks 检查更新
- **THEN** the result message is 「自动更新需要正式签名版」
- **AND** no download is offered

#### Scenario: The automatic check in an unsigned build

- **WHEN** the 自动检查更新 toggle is on in an unsigned build
- **THEN** the automatic check does not run and sends no request

### Requirement: Release builds SHALL be produced and published by CI without Apple credentials

Pushing a `v*` tag SHALL trigger a GitHub Actions run that checks out the
repository, builds the pinned native runtimes from source
（transcribe.cpp v0.4.1；llama.cpp v0.8.0），packages the unsigned macOS app
（DMG + ZIP + update metadata）exactly as the repository's own `pnpm package:mac:artifacts`
does, and publishes a GitHub Release with those artifacts.

The run SHALL use the repository's built-in `GITHUB_TOKEN` for publishing and
SHALL require no Apple credentials. Anyone with repository access SHALL be able
to reproduce the exact same bundle locally with the same script — CI introduces
no build steps a checkout cannot run.

#### Scenario: A version tag is pushed

- **WHEN** a `v*` tag is pushed
- **THEN** a workflow run builds the DMG, ZIP and `latest-mac.yml`
- **AND** creates a GitHub Release for the tag with those artifacts
- **AND** no Apple credential is consulted

#### Scenario: Reproducing a release locally

- **WHEN** a contributor checks out the tag and runs the repository's packaging scripts
- **THEN** the produced bundle matches what CI published in build steps
