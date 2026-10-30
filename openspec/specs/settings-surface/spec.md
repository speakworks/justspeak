# settings-surface Specification

## Purpose
Defines the single settings surface: one preferences IPC path backed by `userData/preferences.json`, a panel reachable from the main window, honest default/override/unavailable labels, inline validation, a window that never gains a page scrollbar, and a read-only provider row that points at the header picker.

## Requirements

### Requirement: Preferences SHALL be read and written through one IPC surface

The main process SHALL expose `preferences:get` and `preferences:set` as the only read and write path for theme and hotkey, SHALL back them with `userData/preferences.json`, and SHALL NOT retain `theme:set`, `hotkey:set`, or a separate theme broadcast. `preferences:set` SHALL accept only `theme` and `hotkey`, SHALL merge accepted values over the current on-disk object, SHALL preserve unknown keys already in that object, and SHALL reject a patch containing an unknown key or an invalid value without writing any part of it. Each successful response SHALL carry the fresh `PreferencesView` so the renderer replaces its single copy instead of maintaining a second one.

#### Scenario: Both preferences use the one surface

- **WHEN** the user changes the theme or the hotkey
- **THEN** the renderer sends `preferences:set` with that key
- **AND** no other IPC channel can write either preference

#### Scenario: Merge-on-write

- **WHEN** the hotkey is saved after a theme was saved
- **THEN** the theme survives, and saving the theme in turn preserves the hotkey
- **AND** a key written by another feature and not understood by this version survives both writes

#### Scenario: Invalid values are rejected

- **WHEN** a patch contains an invalid theme, an invalid or modifier-less hotkey, or an unknown key
- **THEN** the whole patch is rejected with a reason
- **AND** the file is left byte-for-byte unchanged

#### Scenario: Renderer copy cannot drift

- **WHEN** a preference write succeeds
- **THEN** the renderer adopts the returned `PreferencesView`
- **AND** it has no independent persisted theme or hotkey state

### Requirement: A settings panel SHALL be reachable and own the controls

The main window SHALL provide a control that opens one settings panel. The panel SHALL show theme, hotkey, vocabulary, and provider, each with its current value and a control where the setting is editable. The three-state theme control and the hotkey editor SHALL live in the panel, and the header SHALL keep a compact read-out of the active appearance.

#### Scenario: Opening the panel

- **WHEN** the user activates the header settings control
- **THEN** the panel replaces the dictation cards in the same window
- **AND** every row shows its current value

#### Scenario: Theme control moved

- **WHEN** the panel is open
- **THEN** the panel exposes system, light, and dark choices
- **AND** the header shows the current appearance without a cycling control

#### Scenario: Closing the panel

- **WHEN** the user activates the close or return control
- **THEN** the dictation cards return
- **AND** no preference is lost

### Requirement: Every setting SHALL report default, override, or unavailable

Each row SHALL show exactly one of `default`, `override`, or `unavailable`, and an unavailable row SHALL state what is missing rather than presenting an enabled control that silently fails. Theme SHALL be default when it follows the system, a hotkey SHALL be default when it equals the built-in accelerator, a vocabulary SHALL be default when no file exists, loaded when parsed, and unavailable with the parse or read reason when the file cannot be used, and the provider row SHALL report the live provider: `default` with a pointer to the header picker when the provider can be switched, or `unavailable` with the reason when no provider is live.

#### Scenario: Default state

- **WHEN** a setting still holds its built-in value or no vocabulary file exists
- **THEN** the row is labelled default

#### Scenario: User override

- **WHEN** the user pinned an appearance, bound a different accelerator, or a vocabulary file was loaded
- **THEN** the row is labelled overridden and names the current value

#### Scenario: Provider row points at the header picker

- **WHEN** the panel renders the provider row and a provider is live
- **THEN** the row is labelled default
- **AND** it shows the live provider label
- **AND** its control is disabled because the model is switched from the window header
- **AND** it states that the model is switched from the header picker

#### Scenario: No provider is live

- **WHEN** no provider is live
- **THEN** the provider row is labelled unavailable
- **AND** it states that ASR is not ready and no model can be switched

### Requirement: Validation SHALL report inline

Invalid hotkey input and an unreadable vocabulary file SHALL report inside the panel without a modal dialog. Applying an invalid or unchanged hotkey SHALL be disabled, and a refused binding SHALL name the fallback that is live. Reloading SHALL re-read the vocabulary file and refresh the post-processing stage from the same result.

#### Scenario: Invalid hotkey

- **WHEN** the user types a binding without a modifier or with an unknown token
- **THEN** the field and its message show the reason inline
- **AND** the apply action is disabled

#### Scenario: Unreadable vocabulary

- **WHEN** `vocabulary.json` exists but is not valid JSON or is not an object
- **THEN** the vocabulary row is unavailable and shows the parse reason inline
- **AND** no modal is shown

#### Scenario: Reload

- **WHEN** the user activates reload after editing or repairing the vocabulary file
- **THEN** the panel shows the fresh state and counts
- **AND** subsequent transcripts use the freshly loaded word list

### Requirement: The panel SHALL NOT add a page scrollbar

Opening the panel at the fixed 720×640 window SHALL NOT make `document.documentElement.scrollHeight` exceed `window.innerHeight`, in both light and dark themes. The dictation layout's existing no-scroll behavior SHALL be preserved.

#### Scenario: Measured at 720×640

- **WHEN** the panel is open in light mode and again in dark mode
- **THEN** `document.documentElement.scrollHeight` is less than or equal to `window.innerHeight`
- **AND** the transcript card's fixed height and its internal scroll are unchanged
