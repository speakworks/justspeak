## Purpose

Defines the observable dictation session behavior in the Electron main process: state transitions, recording-summary validation, transcript delivery, clipboard preservation during paste, and how failures are surfaced without losing user text.

## ADDED Requirements

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
