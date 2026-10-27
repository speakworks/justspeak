## Purpose

Defines the observable dictation session behavior in the Electron main process: state transitions, recording-summary validation, transcript delivery, clipboard preservation during paste, and how failures are surfaced without losing user text.

## ADDED Requirements

### Requirement: Session state SHALL follow one explicit state machine

The session SHALL move through `idle → recording → transcribing → pasting → idle`, with `error` reachable from any active state, and SHALL reject or ignore events that are invalid for the current state.

#### Scenario: Happy path

- **WHEN** the user starts recording, stops, the provider returns a transcript, and paste succeeds
- **THEN** the renderer observes `recording`, `transcribing`, `pasting`, and `idle` in order
- **AND** exactly one transcript event is emitted for the utterance

#### Scenario: Stale stop event

- **WHEN** a `capture:stopped` message arrives while the session is not transcribing
- **THEN** the message is ignored without changing state or emitting a transcript

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

### Requirement: Transcript delivery SHALL identify provenance

Every transcript event SHALL include the text, whether it came from the fake provider, the audio duration, and the measured latency.

#### Scenario: Fake transcript is tagged

- **WHEN** the fake provider produces a transcript
- **THEN** the event carries `fake: true`
- **AND** a Qwen3 transcript carries `fake: false` with real provider latency

#### Scenario: Provider error is visible

- **WHEN** the provider returns a typed error after the bounded retry policy
- **THEN** the session enters error with a user-readable message
- **AND** no transcript event is emitted and no fallback provider is invoked

### Requirement: Transient ASR failures SHALL retry once with the same provider

The session SHALL retry the same utterance once with the same provider on `TIMEOUT` or a retryable `INFERENCE_FAILED`, and SHALL NOT retry `CANCELLED`, `AUDIO_TOO_LONG`, `MODEL_MISSING`, `MODEL_LOAD_FAILED`, or `UNSUPPORTED_LANGUAGE`; no retry may switch providers.

#### Scenario: Transient failure recovers

- **WHEN** the first provider call returns `TIMEOUT` or retryable `INFERENCE_FAILED`
- **THEN** the session retries once with the same provider and the same audio
- **AND** a successful second call produces the normal transcript event

#### Scenario: Retry policy is bounded

- **WHEN** the second attempt also fails
- **THEN** the session enters error with the second error's message
- **AND** it does not invoke a fallback provider or a third attempt

#### Scenario: Non-retryable failure is not retried

- **WHEN** the provider returns `CANCELLED`, `AUDIO_TOO_LONG`, `MODEL_MISSING`, `MODEL_LOAD_FAILED`, or `UNSUPPORTED_LANGUAGE`
- **THEN** the session reports the error immediately without a second call

### Requirement: Clipboard injection SHALL snapshot and restore the clipboard

The paste strategy SHALL snapshot the clipboard item list exposed by Electron's Clipboard API before writing the transcript, SHALL attempt the paste once, and SHALL restore the snapshot only when the clipboard still contains the transcript it wrote. Items the API cannot expose (for example Finder file promises) are outside this contract.

#### Scenario: Successful paste restores the previous clipboard

- **WHEN** paste succeeds and the clipboard still equals the transcript
- **THEN** the previous clipboard items are restored
- **AND** if full restore fails, the previous plain text is restored when available

#### Scenario: User copy during paste wins

- **WHEN** the clipboard no longer contains the transcript after the paste attempt
- **THEN** the application does not overwrite the user's newer clipboard content

#### Scenario: Paste command failure preserves the transcript

- **WHEN** the paste keystroke fails (for example Accessibility is denied)
- **THEN** the session reports an actionable permission message
- **AND** the transcript remains on the clipboard for manual pasting

#### Scenario: Empty previous clipboard

- **WHEN** the clipboard was empty before injection and the transcript is still present afterward
- **THEN** the clipboard is cleared back to empty rather than leaving the transcript behind
