# hotkey-config Specification

## Purpose
Defines the configurable toggle accelerator: pure Electron-syntax validation, the ADR-0003 `HotkeySource` boundary, registration with a visible default fallback, and persistence in the shared preferences file.

## Requirements

### Requirement: Accelerator validation SHALL be pure and reject unsafe bindings

The accelerator parser SHALL live in `src/core` without importing Electron, SHALL accept Electron accelerator syntax case-insensitively, SHALL return a canonical spelling, and SHALL reject non-strings, empty strings, unparseable tokens, duplicate modifiers, multiple main keys, missing main keys, and bindings without any modifier.

#### Scenario: Valid binding is canonicalized

- **WHEN** the user enters `cmdorctrl+shift+space`
- **THEN** validation succeeds with `CommandOrControl+Shift+Space`
- **AND** the default `CommandOrControl+Shift+Space` remains valid

#### Scenario: Modifier-less binding is rejected

- **WHEN** the user enters `Space` or `A`
- **THEN** validation fails with a message requiring at least one modifier
- **AND** the binding is never passed to the OS

#### Scenario: Unparseable binding is rejected

- **WHEN** the user enters an unknown key name, an empty token, a duplicate modifier, or two main keys
- **THEN** validation fails with a message naming the problem
- **AND** the previously registered accelerator stays live

#### Scenario: Prototype-named tokens cannot act as modifiers

- **WHEN** the user enters `constructor+Space`, `__proto__+Space`, or `Space+constructor`
- **THEN** validation fails with an unknown-token error
- **AND** no accelerator equal to a bare `Space` is produced or registered

### Requirement: Registration SHALL use the HotkeySource boundary and fall back visibly

The main process SHALL register the stored accelerator through a `HotkeySource` implementation, SHALL fall back to `CommandOrControl+Shift+Space` when the OS refuses the stored binding, and SHALL surface a message naming the refused binding. If the fallback also fails, the message SHALL name both bindings.

#### Scenario: Stored binding is available

- **WHEN** the stored accelerator registers successfully at startup
- **THEN** it is the active accelerator
- **AND** pressing it toggles recording

#### Scenario: Stored binding is taken

- **WHEN** the OS refuses the stored accelerator
- **THEN** the default accelerator is registered instead
- **AND** a visible message names the refused accelerator and the fallback
- **AND** the user still has a working hotkey

#### Scenario: Both bindings are taken

- **WHEN** the OS refuses both the stored accelerator and the default
- **THEN** a visible message names both
- **AND** the app does not silently claim a hotkey is registered

#### Scenario: Rebinding during dictation

- **WHEN** a binding change is requested while recording, transcribing, or pasting
- **THEN** the request is rejected with a message
- **AND** the current accelerator stays registered

### Requirement: The accelerator SHALL persist without losing other preferences

The chosen accelerator SHALL be stored in `userData/preferences.json` through the existing theme preference store, and writes SHALL merge with the existing object so the theme and unknown keys survive. A missing or corrupt file SHALL resolve both preferences to their defaults without throwing.

#### Scenario: Hotkey write preserves the theme

- **WHEN** a hotkey is saved after a theme was saved
- **THEN** reloading returns both the new hotkey and the previous theme

#### Scenario: Theme write preserves the hotkey

- **WHEN** the theme is changed after a hotkey was saved
- **THEN** reloading returns both the new theme and the previous hotkey

#### Scenario: Corrupt file

- **WHEN** `preferences.json` contains invalid JSON or a non-object
- **THEN** loading returns the default theme and the default accelerator without throwing
- **AND** a subsequent save rewrites a valid file

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
