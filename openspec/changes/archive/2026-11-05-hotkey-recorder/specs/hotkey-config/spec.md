## ADDED Requirements

### Requirement: Recording SHALL suspend the live binding safely

Starting a recording SHALL unregister the dictation accelerator so the chord
being recorded reaches the application, SHALL arm a bounded safety restore, and
SHALL restore the previously live accelerator when the recording is cancelled,
abandoned, or times out. Applying a new binding SHALL end the recording without
a separate restore. A recording SHALL be refused while recording, transcribing,
or pasting, and every capture IPC SHALL require the trusted sender.

#### Scenario: Recording the current binding

- **WHEN** the user starts a recording and presses the accelerator that is currently live
- **THEN** the renderer receives the chord instead of the hotkey toggling dictation
- **AND** the chord can be applied or discarded

#### Scenario: Cancel restores the previous binding

- **WHEN** the user presses Escape or moves focus away from an armed recorder
- **THEN** the previously live accelerator is registered again
- **AND** no preference is written

#### Scenario: Abandoned recording

- **WHEN** a recording is still armed after the safety window elapses
- **THEN** main restores the previously live accelerator
- **AND** main pushes the restored accelerator and any message to the renderer

#### Scenario: Recording during dictation

- **WHEN** a recording is requested while the session is recording, transcribing, or pasting
- **THEN** the request is refused with a message
- **AND** the current accelerator stays registered

### Requirement: The renderer SHALL record the next chord and show the registered accelerator

The settings surface SHALL provide a press-to-record control instead of asking
the user to type accelerator syntax. The control SHALL show the currently
registered accelerator, SHALL arm a recording when activated, SHALL display held
modifiers while the chord is unfinished, SHALL canonicalize the next chord
through the pure capture mapper and accelerator parser, SHALL apply a valid
chord through the single preferences surface, SHALL cancel on bare Escape or
blur, SHALL refuse modifier-less chords and macOS-reserved combinations with a
message, and SHALL display fallback or registration errors returned by main.
Manual typing SHALL NOT be required and SHALL NOT be accepted by the control.

#### Scenario: Record a new binding

- **WHEN** the user activates the control and presses Command+Shift+K
- **THEN** the control shows `⌘ ⇧ K`
- **AND** the binding is applied and the shown current accelerator updates

#### Scenario: Modifier preview

- **WHEN** the user holds Command and Shift before pressing a main key
- **THEN** the control shows `⌘ ⇧` as a pending chord
- **AND** no binding is applied until a main key arrives

#### Scenario: Invalid chord stays armed

- **WHEN** the user presses a modifier-less key, an unsupported key, or Command+Q
- **THEN** the control shows a message naming the problem
- **AND** it keeps waiting for another chord rather than applying anything

#### Scenario: Fallback after apply

- **WHEN** main falls back to the default after a refused binding
- **THEN** the renderer shows the fallback message and the actual registered accelerator

## REMOVED Requirements

### Requirement: The renderer SHALL show live validation and the registered accelerator

**Reason**: The editable accelerator-syntax field asked users to type a developer-facing string. The settings surface now records the chord instead; keeping a typed-draft validator would leave dead production code and a second input path that bypasses the capture suspension.

**Migration**: Users set the accelerator by clicking the recorder and pressing the chord. The pure `parseAccelerator` validation and the existing fallback/error messages are unchanged; only the input mechanism is removed.
