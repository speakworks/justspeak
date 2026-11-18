# history Specification

## Purpose
Keep a local, bounded record of what JustSpeak heard: the text and outcome of each
delivered transcript, the recording that produced it, and the retention rules that keep
both from growing without limit on the user's Mac.

## Requirements

### Requirement: Every finished transcript SHALL be recorded locally

Main SHALL append one history entry for every non-empty transcript the session
delivers. An entry SHALL carry its text, the local timestamp, the recording duration,
the transcription latency and the delivery outcome: `inserted` when the app's own
input received it, `pasted` when the frontmost app received it, `panel` when the copy
panel was shown because no editable element was available, and `paste_failed` when
the paste step failed and the text was left on the clipboard. Recording SHALL be best
effort: a failed history write SHALL NOT change the session state or the delivery
result.

#### Scenario: A transcript is inserted into JustSpeak

- **WHEN** the app window holds focus and a transcript is delivered to the home input
- **THEN** one entry is recorded with outcome `inserted`

#### Scenario: A transcript is pasted into another app

- **WHEN** another app holds focus and the paste step succeeds
- **THEN** one entry is recorded with outcome `pasted`

#### Scenario: The copy panel is shown

- **WHEN** delivery chooses the copy panel
- **THEN** one entry is recorded with outcome `panel`

#### Scenario: The paste step fails

- **WHEN** delivery reaches the paste step and it throws
- **THEN** the session enters `error`
- **AND** one entry is recorded with outcome `paste_failed` and the same text

#### Scenario: History cannot be written

- **WHEN** the history file cannot be appended
- **THEN** the failure is logged
- **AND** the session still reaches its normal success state

### Requirement: History SHALL be shown grouped by local day

The 历史记录 destination SHALL show recorded entries newest first, grouped by the
user's local calendar day and labelled 今天, 昨天 or the full date. Each row SHALL
show its time, text, delivery outcome and duration. The pane SHALL show its
empty state when no entry exists and SHALL surface a read failure instead of
presenting it as an empty history.

#### Scenario: Opening history after dictating

- **WHEN** the user opens 历史记录 after one or more transcripts
- **THEN** the rows appear under the correct local date, newest first

#### Scenario: No history yet

- **WHEN** no entry has ever been recorded
- **THEN** the pane shows the empty state

### Requirement: A row SHALL support copy and delete

Each row SHALL offer copy, which writes the row's text to the system clipboard,
and delete, which removes the row and its audio file.

#### Scenario: Copying a row

- **WHEN** the user activates copy on a row
- **THEN** the system clipboard holds exactly that row's text

#### Scenario: Deleting a row

- **WHEN** the user activates delete on a row
- **THEN** the row disappears from the list and from disk
- **AND** its WAV file is removed

### Requirement: The recording SHALL be stored as WAV and playable

Each entry SHALL save the captured audio as 16 kHz mono PCM16 WAV next to the
history file and SHALL record its relative path and byte size. The pane SHALL
offer playback for entries whose audio is still present, and SHALL omit the
control once the audio has been evicted.

#### Scenario: Playing a recording

- **WHEN** the user activates play on a row with audio
- **THEN** the WAV bytes are loaded from the local history directory and played

#### Scenario: Audio was evicted

- **WHEN** a row survives retention but its audio was dropped
- **THEN** the row still shows its text and no play control

### Requirement: Retention SHALL bound text and audio independently

The product SHALL keep at most the newest 1000 text entries and SHALL drop
entries older than 30 days, whichever binds first. Audio SHALL be kept for the
newest 500 entries only; beyond that the audio file SHALL be removed while the
text row survives. Cleanup SHALL delete audio before rewriting the row file and
SHALL remove WAVs that no surviving entry references. Cleanup SHALL run at
startup and after each append.

#### Scenario: The text cap is exceeded

- **WHEN** more than 1000 entries exist within the age window
- **THEN** the oldest entries beyond the cap are removed with their audio

#### Scenario: The audio cap is exceeded

- **WHEN** more than 500 surviving entries carry audio
- **THEN** audio older than the newest 500 is deleted and the text rows remain

#### Scenario: An interrupted removal left a WAV behind

- **WHEN** the app starts and an audio file is not referenced by any entry
- **THEN** that file is deleted

### Requirement: History SHALL support in-place edits and an undo entry point

A history row SHALL be rewritable in place with the result panel's edited text,
without creating a second entry and without retaining the pre-edit text. The
row whose id matches the current injection record SHALL offer the guarded
undo action (labelled 撤销插入, performing 撤销上一次插入) when the record is
undoable; other rows SHALL NOT show that action. Activating it SHALL run the
same guarded undo path and SHALL report a refusal instead of deleting text in a
different target.

#### Scenario: Editing rewrites the row

- **WHEN** the user edits a transcript in the result panel and reinserts it
- **THEN** the matching history row's text becomes the edited text
- **AND** the entry count and creation time do not change
- **AND** no copy of the original text is kept

#### Scenario: The undo action appears on the matching row

- **WHEN** a paste has just succeeded and the history pane is open
- **THEN** the row for that insertion offers the 撤销插入 action
- **AND** after the undo succeeds the action disappears

#### Scenario: A refusal is reported from history

- **WHEN** the user activates the row action after the target changed
- **THEN** the pane reports the refusal
- **AND** the recorded text remains available in the result panel
