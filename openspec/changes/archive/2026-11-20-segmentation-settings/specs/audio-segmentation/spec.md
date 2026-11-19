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
least two utterances succeeded. Each element SHALL be
`{ index, startMs, durationMs }`, where `index` is the segmenter's zero-based
utterance index, `startMs` is the segment start relative to the capture, and
`durationMs` is its length, both converted from the 16 kHz sample range and
rounded to whole milliseconds. The array SHALL be ordered by utterance and
SHALL contain successful segments only. A one-shot result, a segmented run with
fewer than two successful segments, and a no-speech result SHALL leave the
field absent rather than fabricate entries.

An adapter that assembles its own provider result SHALL forward metadata
supplied by its runner unchanged.

#### Scenario: Two or more successful segments

- **WHEN** a segmented run succeeds for two utterances
- **THEN** the result carries two metadata entries in utterance order
- **AND** their start and duration values match the sample ranges converted to milliseconds

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
