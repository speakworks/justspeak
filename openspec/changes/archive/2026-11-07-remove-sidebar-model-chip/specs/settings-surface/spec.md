## MODIFIED Requirements

### Requirement: A settings panel SHALL be reachable and own the controls

The main window SHALL provide a control at the bottom of the sidebar that opens
one settings surface. That surface SHALL show theme, hotkey, and the ASR provider,
each with its current value and a control where the setting is editable. The
vocabulary editor SHALL live in its own sidebar destination instead. The
three-state theme control, the hotkey editor, and the provider selector SHALL live
in the settings surface, and no other surface SHALL repeat the active appearance
or the live provider.

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

#### Scenario: Settings entry is the only way to the provider row

- **WHEN** the sidebar renders without any view of the running model
- **THEN** the settings entry is the only way to reach the provider row

#### Scenario: Vocabulary is not part of settings

- **WHEN** the settings surface is open
- **THEN** no vocabulary row is rendered there
- **AND** the vocabulary editor is reachable from the 词典 destination

#### Scenario: Closing the panel

- **WHEN** the user selects another destination or closes the surface
- **THEN** the content area returns to that destination
- **AND** no preference is lost
