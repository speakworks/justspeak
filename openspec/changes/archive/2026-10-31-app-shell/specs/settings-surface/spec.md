## MODIFIED Requirements

### Requirement: A settings panel SHALL be reachable and own the controls

The main window SHALL provide a control at the bottom of the sidebar that opens
one settings surface. That surface SHALL show theme and hotkey, each with its
current value and a control where the setting is editable, and SHALL report the
live provider with a pointer to the header picker rather than an editable control.
The vocabulary editor SHALL live in its own sidebar destination instead. The
three-state theme control and the hotkey editor SHALL live in the settings
surface, and the header SHALL keep a compact read-out of the active appearance
and the provider picker.

#### Scenario: Opening the panel

- **WHEN** the user activates the sidebar settings control
- **THEN** the settings surface replaces the content area in the same window
- **AND** every row shows its current value

#### Scenario: Theme control moved

- **WHEN** the settings surface is open
- **THEN** it exposes system, light, and dark choices
- **AND** the header shows the current appearance without a cycling control

#### Scenario: Provider stays switchable from the header

- **WHEN** the settings surface renders the provider row
- **THEN** the row reports the live provider and points at the header picker
- **AND** it does not offer an editable control of its own

#### Scenario: Vocabulary is not part of settings

- **WHEN** the settings surface is open
- **THEN** no vocabulary row is rendered there
- **AND** the vocabulary editor is reachable from the 词典 destination

#### Scenario: Closing the panel

- **WHEN** the user selects another destination or closes the surface
- **THEN** the content area returns to that destination
- **AND** no preference is lost

### Requirement: Validation SHALL report inline

Invalid hotkey input and an unreadable vocabulary file SHALL report inside the
surface that owns them — the settings surface for the hotkey, the 词典
destination for the vocabulary — without a modal dialog. Applying an invalid or
unchanged hotkey SHALL be disabled, and a refused binding SHALL name the fallback
that is live. Reloading SHALL re-read the vocabulary file and refresh the
post-processing stage from the same result.

#### Scenario: Invalid hotkey

- **WHEN** the user types a binding without a modifier or with an unknown token
- **THEN** the field and its message show the reason inline
- **AND** the apply action is disabled

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

### Requirement: Every setting SHALL report default, override, or unavailable


Each row SHALL show exactly one of `default`, `override`, or `unavailable`, and an unavailable row SHALL state what is missing rather than presenting an enabled control that silently fails. Theme SHALL be default when it follows the system, a hotkey SHALL be default when it equals the built-in accelerator, the vocabulary SHALL report default when no file exists, loaded when parsed, and unavailable with the parse or read reason when the file cannot be used — in the 词典 destination, which is where its row lives, and the provider row SHALL report the live provider: `default` with a pointer to the header picker when the provider can be switched, or `unavailable` with the reason when no provider is live.

#### Scenario: Default state

- **WHEN** a setting still holds its built-in value, or no vocabulary file exists (the latter reported in 词典)
- **THEN** the row is labelled default

#### Scenario: User override

- **WHEN** the user pinned an appearance, bound a different accelerator, or a vocabulary file was loaded (the last reported in 词典)
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

## RENAMED Requirements

- FROM: `### Requirement: The panel SHALL NOT add a page scrollbar`
- TO: `### Requirement: The shell SHALL NOT add a page scrollbar`
