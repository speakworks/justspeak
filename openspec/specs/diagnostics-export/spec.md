# diagnostics-export Specification

## Purpose
TBD - created by archiving change diagnostics-export. Update Purpose after archive.

## Requirements

### Requirement: Diagnostics export SHALL be local-only and user-initiated

The app SHALL export diagnostics only after an explicit user action. It SHALL
write a zip to a path chosen by the user and SHALL NOT upload it or contact a
network service. Canceling the save dialog SHALL write nothing and SHALL NOT
show an error.

#### Scenario: User exports diagnostics

- **WHEN** the user chooses 导出诊断 and picks a save path
- **THEN** the app writes a zip at that path and reports the path
- **AND** no network request is made

#### Scenario: User cancels

- **WHEN** the user dismisses the save dialog
- **THEN** no file is written and no error is shown

### Requirement: The bundle SHALL contain only diagnosed state

The zip SHALL contain `summary.json`, recent main-process logs, recent crash
dumps, and a README. `summary.json` SHALL include app/runtime versions,
platform, provider health, permission status, runtime/model presence, and a
preference summary without secrets. `summary.json`, the logs, and `README.txt`
SHALL NOT contain transcripts, clipboard contents, history text, audio,
vocabulary entries, API keys, or raw endpoint URLs. Crash dumps are separately
OS-generated process memory and MAY contain transient content or in-memory
secrets (including a local sidecar API key or a decrypted endpoint key); the
README and the settings copy SHALL disclose that and tell the user to inspect
the zip before sharing.

#### Scenario: Sensitive files are excluded

- **WHEN** the bundle is created after a dictation with history and a saved API key
- **THEN** `summary.json`, the logs, and `README.txt` contain no history database, audio file, transcript text, or key material
- **AND** `summary.json` reports only whether a key exists
- **AND** any included crash dumps are disclosed as possible process memory

#### Scenario: Symlinked dump or log

- **WHEN** a symlink appears in the crash-dump directory or at the log path
- **THEN** the app does not follow it, write through it, or include its target

### Requirement: Logs SHALL be persisted with redaction and rotation

The main process SHALL append console output to a log file under the app logs
directory, rotate it by size, and flush on quit. Redaction SHALL replace the
home and userData paths with stable placeholders and mask bearer tokens.
Logging failures SHALL NOT propagate into dictation.

#### Scenario: Redaction

- **WHEN** a log line contains the home path, the userData path, or `Bearer secret`
- **THEN** the exported log contains placeholders instead of those values

#### Scenario: Rotation

- **WHEN** the active log exceeds the size cap
- **THEN** the app rotates it to a backup and starts a new active file

### Requirement: The export SHALL be trusted-sender-only and single-flight

The `diagnostics:export` IPC handler SHALL reject untrusted senders and SHALL
run at most one export at a time. The renderer SHALL receive only the result
status, saved path, or message.

#### Scenario: Concurrent export

- **WHEN** the user triggers export twice before the first finishes
- **THEN** the second call returns a busy result and does not write a second zip
