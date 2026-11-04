## ADDED Requirements

### Requirement: The local sidecar SHALL require a per-start API key

Each `llama-server` start SHALL generate a random API key and require it for
chat-completion requests. `/health` MAY remain unauthenticated so the
supervisor can poll it. A request without the key or with a wrong key SHALL
receive 401.

#### Scenario: Unauthenticated request

- **WHEN** a local process calls `/v1/chat/completions` without the key
- **THEN** llama-server returns 401 and no completion is produced

#### Scenario: Supervisor request

- **WHEN** the app calls `/v1/chat/completions` with the generated key
- **THEN** the request succeeds

### Requirement: The key SHALL be private and temporary

The key SHALL be written to a `0600` file inside a private temp directory and
passed with `--api-key-file`, so it does not appear in process arguments. The
file and directory SHALL be removed after the server becomes healthy. The key
SHALL NOT appear in logs. A failed start, stop, or restart SHALL remove any key
file.

#### Scenario: Key cleanup

- **WHEN** the sidecar becomes healthy
- **THEN** the key file no longer exists on disk
- **AND** the running server still accepts the key in memory

#### Scenario: Key not logged

- **WHEN** the sidecar start line is written to the app log
- **THEN** it contains the key file path but not the key value

### Requirement: Startup SHALL fail closed if the runtime ignores the key

After `/health`, the supervisor SHALL send one unauthenticated chat-completion
request and SHALL require 401. Any other status SHALL stop the sidecar and
reject the start. The key remains in main-process memory after the file is
deleted; diagnostics documentation SHALL disclose that a crash dump can contain
in-memory secrets.

#### Scenario: Runtime ignores the key

- **WHEN** a llama-server build accepts `--api-key-file` but serves a request without the key
- **THEN** the app stops that sidecar and reports the local model as failed
