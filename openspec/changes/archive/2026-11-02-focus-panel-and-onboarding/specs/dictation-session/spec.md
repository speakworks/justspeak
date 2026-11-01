## MODIFIED Requirements

### Requirement: Delivery SHALL target the app's own input when it owns focus

When a transcript is ready, main SHALL insert it into the app's own input when the
app's main window has focus, and SHALL NOT synthesize a keystroke. Otherwise main
SHALL probe the frontmost element's Accessibility role and text-selection support.
When the role is `AXTextField`, `AXTextArea`, or `AXComboBox` and the element
supports `AXSelectedTextRange`, main SHALL paste once through the existing
clipboard contract. When the element is non-editable, or the probe cannot answer,
main SHALL show the persistent copy panel just above the recording pill's position
and SHALL NOT paste. An unreadable probe takes precedence over the paste-failure
scenario: a denied Accessibility permission surfaces as the copy panel, not as a
clipboard error. The panel SHALL not take focus, SHALL show the transcript and a
copy action, and SHALL dismiss on copy, close, or Escape. While the panel is
visible, Escape SHALL be a temporary global shortcut; if the OS refuses that
registration, the panel SHALL NOT promise Escape and close SHALL remain
available. No delivery path may lose the text.

#### Scenario: Dictating into the app's own window

- **WHEN** the app's main window is focused and a transcript is ready
- **THEN** no paste keystroke is synthesized
- **AND** the transcript is delivered to the renderer, which inserts it once

#### Scenario: Dictating into another application

- **WHEN** the app's main window is not focused and the frontmost element is editable
- **THEN** the transcript is pasted into the frontmost application
- **AND** the renderer does not insert it into the home input

#### Scenario: Dictating into an editable frontmost element

- **WHEN** the frontmost element's role is editable and it supports a text range
- **THEN** the transcript is pasted exactly once
- **AND** the copy panel is not shown

#### Scenario: Dictating into a non-editable element

- **WHEN** the frontmost element is a non-editable role, or the probe cannot answer
- **THEN** no paste is attempted
- **AND** the copy panel shows the transcript without taking focus

#### Scenario: Copying from the panel

- **WHEN** the user activates copy in the panel
- **THEN** the system clipboard holds exactly the panel's text
- **AND** the panel dismisses

#### Scenario: Dismissing the panel

- **WHEN** the user closes the panel, presses Escape, or starts a new recording
- **THEN** the panel hides
- **AND** no text is pasted

#### Scenario: A repeated transcript replaces the panel content

- **WHEN** a second transcript needs the panel while it is already visible
- **THEN** the panel shows the newer text
- **AND** it moves to the current pointer's display
