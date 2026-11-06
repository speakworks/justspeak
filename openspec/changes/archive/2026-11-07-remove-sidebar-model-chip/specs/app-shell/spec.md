## MODIFIED Requirements

### Requirement: The main window SHALL present a sidebar of destinations

The window SHALL show a persistent sidebar listing 首页, 历史记录 and 词典, SHALL
mark the current destination, and SHALL offer a settings entry at the bottom of
the sidebar. Each destination SHALL be named by a page header carrying its title
and a one-line description. The window SHALL NOT keep a record button or a
transcript card.

#### Scenario: Switching destinations

- **WHEN** the user selects 历史记录 or 词典
- **THEN** the content area shows that destination, the sidebar marks it, and the
  page header names it
- **AND** the settings entry remains available from the sidebar

#### Scenario: Opening settings

- **WHEN** the user activates the sidebar's settings entry
- **THEN** the appearance, hotkey and model settings are shown, named by the page
  header
- **AND** the header offers the only control that returns to 首页
- **AND** the vocabulary editor is not part of that view
