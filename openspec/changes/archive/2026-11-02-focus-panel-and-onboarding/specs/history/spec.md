## MODIFIED Requirements

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
