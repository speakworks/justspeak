## MODIFIED Requirements

### Requirement: Segmented dictation SHALL default to `auto` and keep partial failures visible

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
