# settings-surface Specification

## Purpose
Defines the single settings surface: one preferences IPC path backed by `userData/preferences.json`, a panel reachable from the main window, honest default/override/unavailable labels, inline validation, a window that never gains a page scrollbar, and an editable provider row in the settings panel.

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

The main window SHALL provide a control at the bottom of the sidebar that opens
one settings surface. That surface SHALL show theme, hotkey, and the ASR provider,
each with its current value and a control where the setting is editable. The
vocabulary editor SHALL live in its own sidebar destination instead. The
three-state theme control, the hotkey editor, and the provider selector SHALL live
in the settings surface; the sidebar footer SHALL report the live provider label
and SHALL open the settings surface when activated rather than acting as a picker;
no other surface SHALL repeat the active appearance.

#### Scenario: Opening the panel

- **WHEN** the user activates the sidebar settings control
- **THEN** the settings surface replaces the content area in the same window
- **AND** every row shows its current value

#### Scenario: Theme control moved

- **WHEN** the settings surface is open
- **THEN** it exposes system, light, and dark choices
- **AND** no other surface repeats the active appearance or offers a cycling control

#### Scenario: Provider is switchable from the settings panel

- **WHEN** the settings surface renders the provider row and a provider is live
- **THEN** the row offers the selectable providers and changing the selection
  switches the live provider
- **AND** the header offers no picker, so the row is the only switch point

#### Scenario: Provider chip opens settings

- **WHEN** the user activates the provider label in the sidebar footer
- **THEN** the settings surface opens
- **AND** the chip itself does not change the provider

#### Scenario: Vocabulary is not part of settings

- **WHEN** the settings surface is open
- **THEN** no vocabulary row is rendered there
- **AND** the vocabulary editor is reachable from the 词典 destination

#### Scenario: Closing the panel

- **WHEN** the user selects another destination or closes the surface
- **THEN** the content area returns to that destination
- **AND** no preference is lost

### Requirement: Every setting SHALL report default, override, or unavailable

Each row SHALL show exactly one of `default`, `override`, or `unavailable`, and an unavailable row SHALL state what is missing rather than presenting an enabled control that silently fails. Theme SHALL be default when it follows the system, a hotkey SHALL be default when it equals the built-in accelerator, the vocabulary SHALL report default when no file exists, loaded when parsed, and unavailable with the parse or read reason when the file cannot be used — in the 词典 destination, which is where its row lives, and the provider row SHALL report the live provider: `default` with a detail naming the current model while the provider can be switched, or `unavailable` with the reason when no provider is live.

#### Scenario: Default state

- **WHEN** a setting still holds its built-in value, or no vocabulary file exists (the latter reported in 词典)
- **THEN** the row is labelled default

#### Scenario: User override

- **WHEN** the user pinned an appearance, bound a different accelerator, or a vocabulary file was loaded (the last reported in 词典)
- **THEN** the row is labelled overridden and names the current value

#### Scenario: Provider row names the live model

- **WHEN** the panel renders the provider row and a provider is live
- **THEN** the row is labelled default
- **AND** it shows the live provider label
- **AND** its control is enabled and lists the selectable providers
- **AND** the header carries no picker of its own

#### Scenario: No provider is live

- **WHEN** no provider is live
- **THEN** the provider row is labelled unavailable
- **AND** it states that ASR is not ready and no model can be switched

### Requirement: Validation SHALL report inline

An invalid or refused hotkey chord and an unreadable vocabulary file SHALL
report inside the surface that owns them — the settings surface for the hotkey,
the 词典 destination for the vocabulary — without a modal dialog. An invalid
chord SHALL keep the recorder armed, write nothing, and name the reason; a
refused binding SHALL name the fallback that is live. Reloading SHALL re-read
the vocabulary file and refresh the post-processing stage from the same result.

#### Scenario: Invalid hotkey

- **WHEN** the user records a chord without a modifier, an unsupported key, or a macOS-reserved combination
- **THEN** the recorder shows the reason inline and keeps waiting for another chord
- **AND** no binding is written

#### Scenario: Unreadable vocabulary

- **WHEN** `vocabulary.json` exists but is not valid JSON or is not an object
- **THEN** the 词典 destination shows the parse reason inline
- **AND** no modal is shown

#### Scenario: Reload

- **WHEN** the user activates reload after editing or repairing the vocabulary file
- **THEN** the 词典 destination shows the fresh state and counts
- **AND** subsequent transcripts use the freshly loaded word list

### Requirement: The shell SHALL NOT add a page scrollbar

At the fixed 720×640 window, no destination SHALL make
`document.documentElement.scrollHeight` exceed `window.innerHeight`, in both light
and dark themes. Content that can grow — the home input, the history list — SHALL
scroll inside its own region instead of the page.

#### Scenario: Measured at 720×640

- **WHEN** the settings surface, 首页 with a long transcript, and 词典 are each open in light and in dark mode
- **THEN** `document.documentElement.scrollHeight` is less than or equal to `window.innerHeight`
- **AND** the growth area scrolls internally instead of the page
