## ADDED Requirements

### Requirement: The long-dictation mode SHALL be a persisted three-state preference with an environment override

The app SHALL persist one mode in `userData/preferences.json` under
`segmentation`, with exactly the values `auto`, `vad`, and `single`. `auto`
SHALL be the default and the value used when the stored key is missing, not a
string, or not one of those three values. A preference write SHALL accept only
those three values; any other value SHALL reject the whole patch without
writing, using the same merge path as the theme and hotkey preferences. The
stored value SHALL NOT be dropped when another preference is written.

`JUSTSPEAK_SEGMENTED` SHALL override the preference when its value is valid.
The historical aliases `on` / `segmented` SHALL mean `vad`, and `off` SHALL mean
`single`. When the variable is unset or empty, the stored preference SHALL be
used. When the variable is set but invalid, the app SHALL use the stored
preference and SHALL NOT fail the ASR session; it SHALL produce the readable
notice `JUSTSPEAK_SEGMENTED 的值无效（<value>），已回退到设置中的「<档位名>」。`
with the mode label for the effective preference.

#### Scenario: Each preference resolves to its mode

- **WHEN** the stored preference is `auto`, `vad`, or `single` and no env value is set
- **THEN** the effective mode is that same value
- **AND** `auto` remains the one-shot path until an utterance exceeds the provider limit

#### Scenario: Missing or corrupt preference falls back to auto

- **WHEN** `preferences.json` omits `segmentation` or stores an unknown value
- **THEN** the read value is `auto`
- **AND** no other preference is reset

#### Scenario: Invalid preference write is rejected atomically

- **WHEN** a patch contains `segmentation: "aggressive"` together with a valid theme
- **THEN** the whole patch is rejected with a reason
- **AND** the file is left unchanged

#### Scenario: Valid env value overrides the preference

- **WHEN** `JUSTSPEAK_SEGMENTED=vad` and the stored preference is `single`
- **THEN** the effective mode is `vad`
- **AND** the settings view reports an environment takeover

#### Scenario: Invalid env value falls back instead of failing

- **WHEN** `JUSTSPEAK_SEGMENTED=loud` and the stored preference is `vad`
- **THEN** the effective mode is `vad`
- **AND** the session remains usable
- **AND** the notice names `loud` and the label for `vad`

### Requirement: Saving the mode SHALL report a truthful apply state

A saved mode SHALL be applied through the existing provider-build path when no
recording is in flight and a valid env value is not in charge. If the pipeline
is busy, the change SHALL be deferred rather than interrupting the recording,
and the settings view SHALL report `已保存，下次启动生效；当前生效：<档位>。`
with the mode that is still running. When a valid env value is in charge, the
saved preference SHALL NOT be reported as effective.

#### Scenario: Idle save applies immediately

- **WHEN** the user saves `vad` while idle and `JUSTSPEAK_SEGMENTED` is unset
- **THEN** the provider is rebuilt with the segmented path
- **AND** the view reports `vad` as effective with no restart notice

#### Scenario: Busy save is deferred honestly

- **WHEN** the user saves a different mode while recording or transcribing
- **THEN** the recording is not interrupted
- **AND** the view says the choice applies next launch and names the current mode

### Requirement: Segmented results SHALL carry successful segment metadata

A segmented provider SHALL include `segments` on a successful result when at
least two provider calls succeeded. Entries SHALL be aggregated by the
segmenter's original VAD utterance, not by the provider's internal chunks: one
entry per utterance, so a single continuous utterance split for a provider's
per-call limit is one segment rather than several. Each element SHALL be
`{ index, startMs, durationMs }`, where `index` is the segmenter's zero-based
utterance index, `startMs` is that utterance's first chunk start relative to
the capture, and `durationMs` is the sum of the utterance's successful chunk
durations, both converted from the 16 kHz sample range and rounded to whole
milliseconds. A failed chunk SHALL NOT contribute duration, and an utterance
SHALL appear when at least one of its chunks succeeded. The array SHALL be
ordered by utterance and SHALL contain utterances with successful chunks only.
A one-shot result, a segmented run with fewer than two successful provider
calls, and a no-speech result SHALL leave the field absent rather than
fabricate entries.

An adapter that assembles its own provider result SHALL forward metadata
supplied by its runner unchanged.

#### Scenario: Two or more successful provider calls

- **WHEN** a segmented run succeeds for two utterances
- **THEN** the result carries two metadata entries in utterance order
- **AND** their start and duration values match the sample ranges converted to milliseconds

#### Scenario: One long utterance split internally

- **WHEN** a single continuous utterance is longer than the provider's per-call limit
- **THEN** it is transcribed in several chunks but reported as one metadata entry
- **AND** its duration is the sum of the successful chunks

#### Scenario: Zero-duration boundary

- **WHEN** a successful segment has an empty sample range
- **THEN** its metadata entry reports `durationMs: 0`
- **AND** the conversion does not discard the entry

#### Scenario: One-shot path has no metadata

- **WHEN** the mode is `single`, or `auto` stays under the provider limit
- **THEN** the result does not carry `segments`

#### Scenario: Partial failure reports successes only

- **WHEN** one segment fails and the others succeed
- **THEN** `segments` contains only the successful utterances
- **AND** the `SEGMENT_FAILED` warning still names the failed index

## MODIFIED Requirements

### Requirement: Segmented transcription SHALL default to `auto`, be final-only, and ordered

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

#### Scenario: Invalid env mode falls back to the preference

- **WHEN** the opt-in selector `JUSTSPEAK_SEGMENTED` has an unknown value
- **THEN** the effective mode is the stored preference
- **AND** the session remains usable
- **AND** the settings surface names the invalid value and the effective preference

#### Scenario: Invalid VAD parameter fails closed

- **WHEN** a VAD parameter (`JUSTSPEAK_VAD_*` or `JUSTSPEAK_SEGMENT_MIN_MS`) is invalid
- **THEN** startup reports a visible error
- **AND** the application does not silently run a different VAD configuration

