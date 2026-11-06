## Purpose

Defines the single settings surface: one preferences IPC path backed by `userData/preferences.json`, a panel reachable from the main window, honest default/override/unavailable labels, inline validation, a window that never gains a page scrollbar, and an editable provider row in the settings panel.

## MODIFIED Requirements

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
