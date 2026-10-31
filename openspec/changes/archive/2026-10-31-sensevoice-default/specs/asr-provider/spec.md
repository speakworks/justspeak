## MODIFIED Requirements

### Requirement: The selected app provider SHALL not fall back silently

The app SHALL default to `sensevoice`, SHALL read the selected provider from a persisted preference, SHALL keep a non-empty `JUSTSPEAK_ASR` as an explicit override, and SHALL NOT switch providers, models, or to cloud on failure. Because the default provider accepts at most 30 seconds of audio, the default segmentation mode SHALL be `auto`: the one-shot path for any utterance inside the selected provider's own limit, and the segmented path only beyond it.

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
