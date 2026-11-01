## MODIFIED Requirements

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
- **THEN** the indicator keeps the same bars at their resting geometry while the
  session is transcribing or pasting
- **AND** the bars stop following the microphone level
- **AND** it disappears after the transcript has been delivered or when the
  session enters `error`

### Requirement: The indicator SHALL show level, not decoration

The waveform SHALL be driven by the level of the audio actually being captured
only while recording, and SHALL update at no more than 30 frames per second. In
the working form the bars SHALL NOT follow the microphone; they SHALL use the
deterministic colour walk below.

#### Scenario: Speaking and pausing

- **WHEN** the user speaks, then stops
- **THEN** the recording waveform amplitude follows the captured level and falls when the input is silent
- **AND** no more than 30 level updates are pushed in any one second

#### Scenario: Working

- **WHEN** the session is transcribing or pasting
- **THEN** the microphone level no longer changes the bars
- **AND** only the walk's colour state changes

## ADDED Requirements

### Requirement: The working form SHALL reuse the recording bars

The working form SHALL reuse the same bar elements and resting geometry as the
recording waveform — the same count, width, height, and pill size — and SHALL
change only their colour. One lit bar SHALL walk left to right, one step at a
time; bars it has passed SHALL stay lit, and the active bar SHALL make a small
upward hop. The last bar SHALL be the completion signal. The form SHALL NOT show
text, a progress number, or a separate track.

#### Scenario: Starting the working form

- **WHEN** the session enters `transcribing` or `pasting`
- **THEN** the waveform stops following the level and freezes at its resting size
- **AND** the first bar becomes the active highlight

#### Scenario: Walking

- **WHEN** the working form stays visible
- **THEN** the active bar advances one bar at a time and the passed bars stay lit
- **AND** the bars' geometry and the pill's bounds do not change

#### Scenario: Delivery arrives first

- **WHEN** the transcript is delivered before the walk reaches the last bar
- **THEN** the highlight jumps directly to the last bar
- **AND** the pill hides after a short completion beat

#### Scenario: Walk reaches the last bar first

- **WHEN** the walk reaches the last bar before delivery
- **THEN** the last bar stays lit and the walk does not loop, reverse, or restart
- **AND** the pill hides when delivery completes

#### Scenario: Reduced motion

- **WHEN** the system asks for reduced motion
- **THEN** the upward hop is disabled
- **AND** the colour walk remains readable
