## Purpose

Defines the replaceable ASR provider boundary behavior: the deterministic fake used by tests, the Qwen3-ASR and SenseVoice adapters backed by a pinned local runtime, typed results and errors, trustworthy model installation, capability-driven UI rendering, and the rule that a selected local provider never silently falls back to another provider.

## MODIFIED Requirements

### Requirement: ASR providers SHALL implement the ADR-0003 provider contract

Every ASR adapter SHALL expose an `id`, truthful `capabilities`, `prepare`, `transcribe`, `dispose`, and `health`, and SHALL return a `ProviderResult<TranscriptionResult>` rather than throwing transport or process errors across the boundary.

#### Scenario: Successful transcription result shape

- **WHEN** a provider receives 16 kHz mono PCM and transcribes it successfully
- **THEN** it returns `{ ok: true, value }` whose value contains the transcript text, `latencyMs`, `modelId`, `runtimeId`, and a warnings array
- **AND** the returned language, when present, is not translated or transformed

#### Scenario: Capability honesty

- **WHEN** a caller reads the provider capabilities
- **THEN** declared values match actual behavior for the fake, Qwen3, and SenseVoice adapters, including final-only (`streaming: false`)
- **AND** the maximum accepted audio duration is declared and enforced

#### Scenario: Capability-driven rendering

- **WHEN** the UI renders the active provider
- **THEN** it derives languages, streaming, and the duration limit from the declared capabilities
- **AND** it does not map a provider id to a capability value

#### Scenario: Silent or empty audio

- **WHEN** the SenseVoice provider receives non-empty audio whose normalized RMS is below the documented silence threshold
- **THEN** it returns a successful result with empty text and no invented text
- **AND** the SenseVoice result carries a `NO_SPEECH` warning and the runtime is not spawned
- **AND** audio at or above the threshold is sent to the model; gating every speechless input is deferred to the VAD change
- **WHEN** the Qwen3 provider receives digital silence
- **THEN** it returns empty text without inventing a token
- **AND** an empty capture follows the existing empty-input path, where the runner decides the result
- **AND** the caller may surface an empty-transcript notice

#### Scenario: Digital silence does not become pasted text

- **WHEN** the selected provider receives an utterance that is entirely digital silence
- **THEN** the transcript is empty for both catalog-backed providers
- **AND** no hallucinated token reaches the paste path

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

- **WHEN** the user removes the selected model file from `models/`
- **THEN** the next start treats it as a first run and re-downloads or reports the missing artifact

#### Scenario: Source and license visibility

- **WHEN** any catalog-backed provider is selected
- **THEN** the UI shows that model's name, license, and source URL
- **AND** no model weights are committed to the repository

### Requirement: The selected app provider SHALL not fall back silently

The app SHALL default to `qwen3`, SHALL read the selected provider from a persisted preference, SHALL keep a non-empty `JUSTSPEAK_ASR` as an explicit override, and SHALL NOT switch providers, models, or to cloud on failure.

#### Scenario: Selection precedence

- **WHEN** the app resolves a provider
- **THEN** a non-empty `JUSTSPEAK_ASR` wins, otherwise the persisted preference applies, otherwise `qwen3` is used

#### Scenario: Missing qwen3 runtime at startup

- **WHEN** the app starts with qwen3 selected and the runtime or model is unavailable
- **THEN** the session enters the error state with a message naming the missing artifact, the source URL, and the repair path
- **AND** no fake or cloud transcript is produced

#### Scenario: Fake mode remains available

- **WHEN** the app starts with `JUSTSPEAK_ASR=fake`
- **THEN** the deterministic fake transcript flow works without model files or network access
- **AND** a persisted preference cannot select `fake`

#### Scenario: Unknown provider value

- **WHEN** the environment variable or the persisted preference names a value outside `qwen3`, `sensevoice`, and the test-only `fake`
- **THEN** the app enters the error state naming the accepted values
- **AND** it does not silently choose a provider

#### Scenario: No cross-provider fallback

- **WHEN** the selected provider fails during transcription
- **THEN** the session surfaces an error naming that provider and keeps the audio/transcript state
- **AND** no other provider or cloud service is invoked

## ADDED Requirements

### Requirement: SenseVoice provider SHALL use the pinned runtime and pinned weights with honest capabilities

The SenseVoice adapter SHALL invoke the pinned transcribe.cpp v0.4.1 CLI against the catalog-pinned SenseVoice Small Q8_0 GGUF, declare the FunASR model license, and enforce the model's 30-second window rather than the runtime's permissive long-audio fallback.

#### Scenario: Real WAV transcription

- **WHEN** the SenseVoice provider is selected and the user records a speech utterance within 30 seconds
- **THEN** the provider writes a temporary 16 kHz mono WAV, runs the pinned CLI with the pinned model, and returns the parsed transcript with `modelId` and `runtimeId`

#### Scenario: Audio over the trained window

- **WHEN** the input duration exceeds 30,000 ms
- **THEN** the provider returns `AUDIO_TOO_LONG` without spawning the runtime
- **AND** it does not truncate or chunk the audio silently

#### Scenario: Weight license is recorded and not mislabeled

- **WHEN** the SenseVoice entry is displayed or redistributed
- **THEN** the catalog records `FunASR-Model-License-1.1`, the pinned source revision, size, and SHA-256
- **AND** the weights are not described as MIT and are downloaded on first use rather than bundled

#### Scenario: Digital silence is gated before inference

- **WHEN** the utterance's normalized RMS is below the documented `SENSEVOICE_SILENCE_RMS_THRESHOLD`
- **THEN** the adapter returns empty text with a `NO_SPEECH` warning without invoking the CLI
- **AND** audio at or above the threshold still runs inference
- **AND** the threshold is a named constant overridable per instance for tests
