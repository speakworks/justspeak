# audio-segmentation Specification

## Purpose
Defines pure silence-aware speech detection and segmentation over 16 kHz mono PCM16, and the opt-in provider adapter that transcribes the resulting segments sequentially as final text.

## Requirements

### Requirement: Speech detection SHALL use RMS hysteresis and minimum durations

The detector SHALL operate on 16 kHz mono PCM16 with short analysis windows, SHALL open a speech region only when the window RMS reaches the configured start threshold, SHALL keep that region open while RMS stays above a lower end threshold, and SHALL close it only after the configured minimum silence duration. Regions shorter than the configured minimum speech duration SHALL be discarded, and surviving regions SHALL be trimmed of leading and trailing silence and padded by no more than half of each neighbouring gap.

#### Scenario: Speech starts above the start threshold

- **WHEN** a window's normalized RMS reaches the start threshold
- **THEN** a speech region opens at that window

#### Scenario: A dip below the start threshold does not split the region

- **WHEN** RMS falls below the start threshold but stays above the end threshold
- **THEN** the region remains open

#### Scenario: Minimum silence closes the region

- **WHEN** RMS stays below the end threshold for at least the minimum silence duration
- **THEN** the region closes at the first quiet window and the trailing silence is excluded

#### Scenario: Minimum speech rejects a transient

- **WHEN** a detected region is shorter than the minimum speech duration
- **THEN** it is not returned as speech
- **AND** no provider call is made for it

#### Scenario: Silence at both ends is trimmed

- **WHEN** an utterance has silence before and after it
- **THEN** the returned region starts at the utterance boundary plus bounded padding and ends at the utterance boundary plus bounded padding
- **AND** adjacent padded regions never overlap

### Requirement: Segmentation SHALL preserve utterance audio within the session bound

The segmenter SHALL convert detected regions into ordered segments with contiguous sample ranges, SHALL keep every sample inside a returned speech region, SHALL merge a region below the minimum segment length with a neighbour or widen a lone short region instead of dropping it, and SHALL reject input above the 120-second session bound with a typed error rather than truncating it.

#### Scenario: All silence

- **WHEN** the input contains no detected speech
- **THEN** segmentation succeeds with zero segments
- **AND** the caller reports an empty transcript without calling the provider

#### Scenario: No silence

- **WHEN** speech fills the entire input
- **THEN** segmentation returns exactly one segment covering the whole input

#### Scenario: One-word utterance

- **WHEN** a single short utterance is surrounded by silence
- **THEN** segmentation returns one segment containing that utterance and no other speech

#### Scenario: Short region is not dropped

- **WHEN** a detected region is shorter than the minimum segment length
- **THEN** it is merged with a neighbouring region or widened with surrounding silence
- **AND** its speech samples are still present in the output

#### Scenario: Session bound

- **WHEN** the input exceeds 120 seconds of 16 kHz audio
- **THEN** segmentation fails with a typed `AUDIO_TOO_LONG` error
- **AND** the audio is not truncated and no provider call is made

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

### Requirement: Segment failures SHALL keep successes and name the failed index

A failed segment SHALL never discard successful segments. The result SHALL include a typed `SEGMENT_FAILED` error with the zero-based failed indices and each failed segment's sample range, the underlying provider error, and the concatenated text of the segments that succeeded. If no segment succeeds, the adapter SHALL return a provider error whose message names every failed index. Each segment SHALL receive at most one same-provider retry for a timeout or retryable inference failure.

#### Scenario: One segment fails

- **WHEN** one segment returns a non-retryable provider error and the others succeed
- **THEN** the successful text is returned in utterance order
- **AND** the typed error names the failed segment index and sample range
- **AND** the user is shown a message identifying the failed segment

#### Scenario: Every segment fails

- **WHEN** all segments fail
- **THEN** the adapter returns a provider error naming every failed index
- **AND** no partial transcript is presented as complete

#### Scenario: Transient segment failure recovers

- **WHEN** a segment returns `TIMEOUT` or retryable `INFERENCE_FAILED`
- **THEN** the adapter retries that segment once with the same audio and provider
- **AND** a successful retry contributes its text in the correct position

#### Scenario: No speech detected

- **WHEN** segmentation produces zero segments
- **THEN** the adapter returns an empty transcript with a `NO_SPEECH` warning
- **AND** it does not call the provider
