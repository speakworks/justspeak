## MODIFIED Requirements

### Requirement: Segmented transcription SHALL be opt-in, final-only, and ordered

Segmented transcription SHALL be the default mode in its `auto` form — the one-shot path while the utterance fits the selected provider's limit, and the segmented path only beyond it — MAY be forced on or off through explicit configuration, SHALL call the provider once per segment in utterance order, and SHALL concatenate successful text in that same order. With segmentation explicitly disabled, the configuration SHALL pass the original provider through unchanged and SHALL make exactly one provider call with the full utterance. In `auto`, an utterance inside the limit takes that same unchanged path. The segmented path is final-only: it emits no partial transcript during recording and declares `streaming: false`.

#### Scenario: Default path is unchanged

- **WHEN** segmentation is not enabled
- **THEN** the original provider is used directly
- **AND** transcoding a multi-utterance capture makes exactly one provider call with the complete PCM

#### Scenario: Opt-in ordering

- **WHEN** segmentation is enabled and the provider returns distinct text for each call
- **THEN** calls occur in utterance order and the final text is the concatenation in that order

#### Scenario: No partial results

- **WHEN** the segmented provider transcribes several segments
- **THEN** it returns one final result after all segments complete
- **AND** it does not emit intermediate transcript events during recording

#### Scenario: Invalid configuration fails closed

- **WHEN** the opt-in selector has an unknown value or a VAD knob is invalid
- **THEN** startup reports a visible error
- **AND** the application does not silently run the single-shot path in place of the requested mode
