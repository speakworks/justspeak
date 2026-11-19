## ADDED Requirements

### Requirement: Transcript events SHALL carry successful segment metadata

The session SHALL copy `TranscriptionResult.segments` into
`TranscriptEvent.segments` when the provider supplies it, and SHALL leave the
field absent otherwise. It SHALL NOT add, reorder, or recompute the entries.
The copy panel payload SHALL carry the same optional field. When it is present,
the panel SHALL render one line in the form
`<count> 段 · <m:ss> / <m:ss> / …`, with each duration rounded to whole seconds
and formatted `m:ss`; when it is absent or empty, the panel SHALL render no
segment line. History entries SHALL remain unchanged and SHALL NOT persist
segment metadata in this change.

#### Scenario: Segmented transcript reaches the panel

- **WHEN** the provider returns two successful segments and the copy panel is shown
- **THEN** the transcript event carries the same two entries
- **AND** the panel shows `2 段 · <duration> / <duration>`

#### Scenario: One-shot transcript

- **WHEN** the provider returns no segment metadata
- **THEN** the transcript event has no `segments` field
- **AND** the panel renders no segment line

#### Scenario: Partial failure keeps the warning

- **WHEN** a segmented run succeeds for some segments and fails for another
- **THEN** the event carries only the successful entries
- **AND** the user still receives the `SEGMENT_FAILED` notice

#### Scenario: History stays unchanged

- **WHEN** a segmented transcript is written to history
- **THEN** the stored `HistoryEntry` contains no segment field
