## Purpose

Defines the replaceable ASR provider boundary behavior: the deterministic fake used by tests, the Qwen3-ASR adapter backed by a pinned local runtime, typed results and errors, trustworthy model installation, and the rule that a selected local provider never silently falls back to another provider.

## ADDED Requirements

### Requirement: ASR providers SHALL implement the ADR-0003 provider contract

Every ASR adapter SHALL expose an `id`, truthful `capabilities`, `prepare`, `transcribe`, `dispose`, and `health`, and SHALL return a `ProviderResult<TranscriptionResult>` rather than throwing transport or process errors across the boundary.

#### Scenario: Successful transcription result shape

- **WHEN** a provider receives 16 kHz mono PCM and transcribes it successfully
- **THEN** it returns `{ ok: true, value }` whose value contains the transcript text, `latencyMs`, `modelId`, `runtimeId`, and a warnings array
- **AND** the returned language, when present, is not translated or transformed

#### Scenario: Capability honesty

- **WHEN** a caller reads the provider capabilities
- **THEN** declared values match actual behavior, including final-only (`streaming: false`) for both the fake and Qwen3 adapters
- **AND** the maximum accepted audio duration is declared and enforced

#### Scenario: Silent or empty audio

- **WHEN** the provider receives audio that contains no recognizable speech
- **THEN** it returns a successful result with empty text and no invented text
- **AND** the caller may surface an empty-transcript notice

### Requirement: ASR failures SHALL use the shared error taxonomy

Provider failures SHALL be returned as `{ ok: false, error }` with a code from `MODEL_MISSING`, `MODEL_LOAD_FAILED`, `UNSUPPORTED_LANGUAGE`, `AUDIO_TOO_LONG`, `INFERENCE_FAILED`, `TIMEOUT`, or `CANCELLED`, plus a human-readable message and a retryable flag.

#### Scenario: Missing model

- **WHEN** the configured model file or runtime binary is absent
- **THEN** the provider returns `MODEL_MISSING` or `MODEL_LOAD_FAILED` with the expected path and a repair hint
- **AND** no transcript is produced

#### Scenario: Sidecar process failure

- **WHEN** the runtime exits non-zero, emits an error, or produces unparseable output
- **THEN** the provider returns `INFERENCE_FAILED` and preserves a bounded diagnostic message

#### Scenario: Timeout and cancellation

- **WHEN** transcription exceeds the configured timeout or the caller aborts the signal
- **THEN** the provider terminates the child process and returns `TIMEOUT` or `CANCELLED`
- **AND** no late result is delivered after cancellation

#### Scenario: Invalid audio shape

- **WHEN** the input is not 16 kHz mono PCM16
- **THEN** the provider returns `INFERENCE_FAILED` without invoking the runtime

#### Scenario: Unsupported language hint

- **WHEN** the caller supplies a language hint outside the provider's declared languages
- **THEN** the provider returns `UNSUPPORTED_LANGUAGE` without invoking the runtime

#### Scenario: Audio over the duration limit

- **WHEN** the input duration exceeds the declared `maxAudioMs`
- **THEN** the provider returns `AUDIO_TOO_LONG` without invoking the runtime

### Requirement: Qwen3 provider SHALL use a pinned local runtime and model

The Qwen3 adapter SHALL invoke the pinned transcribe.cpp CLI (v0.4.1) against the pinned Qwen3-ASR-0.6B Q8_0 GGUF file, write the utterance as a temporary 16 kHz mono WAV, and delete temporary audio after the result is returned.

#### Scenario: Real WAV transcription

- **WHEN** the user records a speech utterance and the Qwen3 provider is selected
- **THEN** the provider writes a temporary WAV, runs the pinned CLI with the pinned model, and returns the parsed transcript with `modelId` and `runtimeId`

#### Scenario: Temporary audio cleanup

- **WHEN** transcription succeeds, fails, times out, or is cancelled
- **THEN** the temporary WAV file is removed and the PCM buffer reference is released

### Requirement: Model installation SHALL be verified before use

The application SHALL install models from the embedded catalog, SHALL verify each file's SHA-256 and size before making it available (on download and again when an existing file is loaded at startup), and SHALL record source URL and license for display.

#### Scenario: First-run download

- **WHEN** the selected model is absent and a download is permitted
- **THEN** the application downloads to a temporary file, verifies size and SHA-256, atomically renames it into `models/`, and reports progress

#### Scenario: Corrupt or mismatched download

- **WHEN** the downloaded file's size or SHA-256 does not match the catalog
- **THEN** the application deletes the temporary file and reports `MODEL_LOAD_FAILED` with the expected and actual digest
- **AND** the model is never used for transcription

#### Scenario: Download cancelled or interrupted

- **WHEN** the download is aborted or the connection drops
- **THEN** the partial file is deleted and no unverified model appears at the final path
- **AND** a later run retries from the beginning (resume is deferred past M1)

#### Scenario: Manual deletion

- **WHEN** the user removes the model file from `models/`
- **THEN** the next qwen3 start treats it as a first run and re-downloads or reports the missing artifact

#### Scenario: Source and license visibility

- **WHEN** the Qwen3 provider is selected
- **THEN** the UI shows the model name, license, and source URL
- **AND** no model weights are committed to the repository

### Requirement: The selected app provider SHALL not fall back silently

The app SHALL default to `JUSTSPEAK_ASR=qwen3`, SHALL provide `JUSTSPEAK_ASR=fake` for tests and the walking skeleton, and SHALL NOT switch providers, models, or to cloud on failure.

#### Scenario: Missing qwen3 runtime at startup

- **WHEN** the app starts with `JUSTSPEAK_ASR=qwen3` and the runtime or model is unavailable
- **THEN** the session enters the error state with a message naming the missing artifact, the source URL, and the repair command
- **AND** no fake or cloud transcript is produced

#### Scenario: Fake mode remains available

- **WHEN** the app starts with `JUSTSPEAK_ASR=fake`
- **THEN** the existing deterministic fake transcript flow works without model files or network access

#### Scenario: Unknown provider value

- **WHEN** `JUSTSPEAK_ASR` is set to a value other than `qwen3` or `fake`
- **THEN** the app enters the error state naming the accepted values
- **AND** it does not silently choose a provider
