## ADDED Requirements

### Requirement: Cancelling SHALL discard the capture

The session SHALL support cancellation while it is `recording`: the captured
audio SHALL be discarded, no provider call SHALL be made, no transcript SHALL be
emitted, the clipboard SHALL be left untouched, and the session SHALL return to
`idle`. Cancellation SHALL be ignored in every other state.

#### Scenario: Cancel while recording

- **WHEN** cancellation is requested while the session is `recording`
- **THEN** the session moves to `idle`
- **AND** the captured audio is discarded
- **AND** no transcript event is emitted and the clipboard is not written

#### Scenario: The cancelled capture's stop arrives late

- **WHEN** the renderer's `capture:stopped` arrives after a cancellation
- **THEN** it is ignored as a stale event, exactly like any other stop that arrives while not transcribing

#### Scenario: Cancel while transcribing

- **WHEN** cancellation is requested while the session is `transcribing` or `pasting`
- **THEN** the session state does not change and no transcript is discarded

## MODIFIED Requirements

### Requirement: Session state SHALL follow one explicit state machine

The session SHALL move through `idle → recording → transcribing → pasting → idle`,
SHALL allow `recording → idle` when the user cancels, with `error` reachable from
any active state, and SHALL reject or ignore events that are invalid for the
current state.

#### Scenario: Happy path

- **WHEN** the user starts recording and then stops
- **THEN** the stop command moves the session from `recording` to `transcribing` before main waits for `capture:stopped`
- **AND** the renderer flushes its final partial 20 ms batch and sends the stop summary
- **AND** main accepts that final batch for the current session, then emits exactly one transcript event and moves through `pasting` to `idle`

#### Scenario: Cancel short-circuits the chain

- **WHEN** the user cancels while recording
- **THEN** the session goes from `recording` directly to `idle` without entering `transcribing` or `pasting`

#### Scenario: Stale stop event

- **WHEN** a `capture:stopped` message arrives while the session is not transcribing
- **THEN** the message is ignored without changing state or emitting a transcript

#### Scenario: Empty stop during a recording

- **WHEN** stop is requested and the renderer reports a zero-sample summary
- **THEN** the session transitions from `transcribing` to `idle` with an empty-capture notice
- **AND** no provider call or transcript event occurs

#### Scenario: Invalid recording summary

- **WHEN** `capture:stopped` carries missing, negative, or non-finite numbers
- **THEN** the session enters error with a retry message
- **AND** the ASR provider is not called

#### Scenario: Capture failure

- **WHEN** the renderer reports a capture failure during recording or finalizing
- **THEN** the session enters error with the provided message or a generic retry message

#### Scenario: Startup or provider-selection failure

- **WHEN** the app cannot initialize the selected provider, for example a missing model or an unknown `JUSTSPEAK_ASR` value
- **THEN** the session starts in the error state with an actionable message
- **AND** a toggle from the error state retries the normal start path once the cause is fixed

#### Scenario: Unsupported capture sample rate

- **WHEN** a recording summary reports a sample rate other than 16,000 Hz
- **THEN** the session enters error with a readable message
- **AND** it does not invoke the ASR provider or emit a transcript
