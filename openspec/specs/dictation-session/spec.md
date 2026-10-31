# dictation-session Specification

## Purpose
Defines the observable dictation session behavior in the Electron main process: state transitions, recording-summary validation, transcript delivery, clipboard preservation during paste, and how failures are surfaced without losing user text.

## Requirements

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

The session SHALL retry the same utterance once with the same provider on `TIMEOUT` or a retryable `INFERENCE_FAILED`, and SHALL NOT retry `CANCELLED`, `AUDIO_TOO_LONG`, `MODEL_MISSING`, `MODEL_LOAD_FAILED`, or `UNSUPPORTED_LANGUAGE`; no retry may switch providers. M1 has only the fake and Qwen3 adapters, so the ADR's "then offer fallback" clause is out of scope: after the retry the visible error is the terminal outcome, and no audio is retained for a further retry.

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

### Requirement: Post-processing SHALL run between the ASR result and paste

After a successful provider result and before emitting the transcript and pasting, the session SHALL pass the provider text through the configured post-processing stage, so the fake and local providers share one cleanup path. The transcript event SHALL carry the applied rule ids. If the stage returns empty text for a non-empty ASR result, the session SHALL paste the raw text instead. A failed provider result SHALL NOT run the stage and SHALL NOT emit a transcript or paste.

#### Scenario: Fake provider is cleaned

- **WHEN** the fake provider returns `嗯，你好` and the stage removes the filler
- **THEN** the transcript event and the pasted text both contain the cleaned text

#### Scenario: Local provider is cleaned

- **WHEN** a Qwen3 result succeeds
- **THEN** the same stage runs before the transcript event and paste
- **AND** the event still carries `fake: false` and the measured latency

#### Scenario: Applied rules are recorded

- **WHEN** the stage reports that it changed the text
- **THEN** `TranscriptEvent.applied` lists those rule ids in execution order

#### Scenario: Empty stage output

- **WHEN** an injected stage returns empty text for a non-empty ASR result
- **THEN** the session emits and pastes the raw ASR text
- **AND** `applied` is empty

#### Scenario: Provider failure

- **WHEN** the provider returns a typed error after the bounded retry policy
- **THEN** the stage does not run, no transcript is emitted, and nothing is pasted

### Requirement: Segmented dictation SHALL be an opt-in variant with visible partial failures

The session SHALL keep the single-shot provider path for any utterance that fits the selected provider's limit, and SHALL segment only utterances beyond it. Segmentation SHALL additionally be forceable on or off through explicit configuration, SHALL preserve the existing state machine, paste policy, provider contract, and 120-second audio bound, and SHALL make a partially failed segmented result visible to the user while still delivering the successful text.

#### Scenario: Default session is unchanged

- **WHEN** segmentation is not configured
- **THEN** the session moves through `idle → recording → transcribing → pasting → idle` exactly as before
- **AND** it calls the provider once with the complete captured audio

#### Scenario: Segmented session delivers ordered text

- **WHEN** segmentation is configured and every segment succeeds
- **THEN** the session emits one transcript event whose text is the concatenation of segment text in utterance order
- **AND** it pastes that text once and returns to idle

#### Scenario: Partial segment failure is visible

- **WHEN** at least one segment succeeds and at least one fails
- **THEN** the session delivers and pastes the successful text
- **AND** the following idle state carries a message naming the failed segment index and its error
- **AND** the failed audio is not silently presented as transcribed

#### Scenario: Empty segmented capture

- **WHEN** segmentation finds no speech in the captured audio
- **THEN** the session emits an empty transcript and does not call the provider
- **AND** it returns to idle rather than hanging in transcribing

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
