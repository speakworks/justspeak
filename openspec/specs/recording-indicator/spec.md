# recording-indicator Specification

## Purpose
TBD - created by archiving change recording-indicator. Update Purpose after archive.

## Requirements

### Requirement: A recording indicator SHALL be visible over any application

While the session is capturing, a compact indicator SHALL be visible at the
bottom centre of the display containing the pointer, anchored to that display's
work area so it clears the Dock, and SHALL remain visible over other
applications, including full-screen ones and other spaces.

#### Scenario: Dictating into another application

- **WHEN** the user starts recording while an unrelated application is frontmost
- **THEN** the indicator becomes visible at the bottom centre of the pointer's display
- **AND** the frontmost application does not change
- **AND** the app's main window is not raised or focused

#### Scenario: The recording ends

- **WHEN** the session leaves `recording`
- **THEN** the indicator shows its working form while the session is transcribing or pasting
- **AND** it disappears after the transcript has been delivered
- **AND** it disappears when the session enters `error`

### Requirement: The indicator SHALL NOT take focus

The indicator window SHALL be a non-activating panel: it SHALL NOT become the
key window, SHALL NOT be focusable, and interacting with its controls SHALL
leave keyboard focus with the application the user is dictating into.

#### Scenario: Clicking a control

- **WHEN** the user clicks ✕ or ✓ on the indicator
- **THEN** the click reaches the control
- **AND** keyboard focus stays with the previously frontmost application
- **AND** the indicator window is never reported as focused

### Requirement: The indicator SHALL show level, not decoration

The waveform SHALL be driven by the level of the audio actually being captured,
and SHALL update at no more than 30 frames per second.

#### Scenario: Speaking and pausing

- **WHEN** the user speaks, then stops
- **THEN** the waveform amplitude follows the captured level and falls when the input is silent
- **AND** no more than 30 level updates are pushed in any one second

### Requirement: The indicator SHALL contain no text

The indicator SHALL present only the cancel control, the waveform, and the
finish control; it SHALL NOT render labels, a timer, or status sentences.

#### Scenario: Any state

- **WHEN** the indicator is visible in any state
- **THEN** its rendered content contains no text nodes
