## MODIFIED Requirements

### Requirement: Dictation SHALL land in an editable input

首页 SHALL contain exactly one editable input as its working surface, carried by
one card that is fixed at 300 px in height and top-aligned in the pane.
A dictated transcript SHALL be inserted into that input at the caret and SHALL
remain editable afterwards. The input's value and caret SHALL live above the
destination switch, so a transcript that arrives while another destination is
shown is still inserted. The session state SHALL be shown as one quiet footer line
inside that input's card — a dot, its label, and the current hotkey — and a failed
session SHALL show its message inside the same card, below the input. The window
SHALL NOT show a record button, a transcript card or a banner.

#### Scenario: Dictating on the home destination

- **WHEN** a transcript arrives while 首页 is shown and the input holds the caret
- **THEN** its text is inserted at the caret exactly once
- **AND** the input stays editable

#### Scenario: Text arrives while another destination is shown

- **WHEN** the app's main window is focused and a transcript arrives while 历史记录 or 词典 is shown
- **THEN** the text is inserted into the home input
- **AND** it is present when the user returns to 首页

#### Scenario: A session fails

- **WHEN** the session enters `error`
- **THEN** the message is shown inside the input's card, below the input
- **AND** no transcript is inserted

#### Scenario: The card does not stretch

- **WHEN** 首页 is shown with an empty or short input
- **THEN** the card is 300 px tall instead of filling the pane
- **AND** the space below it stays empty

#### Scenario: Long text scrolls inside the input

- **WHEN** the transcript is longer than the card can show at 300 px
- **THEN** the input scrolls internally
- **AND** the card keeps its 300 px height
- **AND** the pane gains no scrollbar

#### Scenario: No pipeline chrome

- **WHEN** 首页 is shown in any session state
- **THEN** the window contains no record/stop button and no transcript card
- **AND** recording state is conveyed by the input's border, the footer dot and
  the global indicator
