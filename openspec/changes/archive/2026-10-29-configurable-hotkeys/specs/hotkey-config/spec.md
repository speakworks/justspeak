## Purpose

Defines the configurable toggle accelerator: pure Electron-syntax validation, the ADR-0003 `HotkeySource` boundary, registration with a visible default fallback, and persistence in the shared preferences file.

## ADDED Requirements

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

### Requirement: The renderer SHALL show live validation and the registered accelerator

The settings surface SHALL provide a compact control to enter an accelerator, SHALL validate it as the user types, SHALL disable applying an invalid or unchanged binding, SHALL show the currently registered accelerator, and SHALL display fallback or registration errors returned by main.

#### Scenario: Live validation

- **WHEN** the user types an invalid binding
- **THEN** the field shows an error message and the apply action is disabled

#### Scenario: Applied binding

- **WHEN** the user applies a valid, changed binding and the OS accepts it
- **THEN** the shown current accelerator updates to the applied value

#### Scenario: Fallback after apply

- **WHEN** main falls back to the default after a refused binding
- **THEN** the renderer shows the fallback message and the actual registered accelerator
