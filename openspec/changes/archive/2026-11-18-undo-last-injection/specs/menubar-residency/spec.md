## ADDED Requirements

### Requirement: The menu-bar icon SHALL offer the guarded undo

The menu-bar icon's menu SHALL also offer 撤销上一次插入, placed between the
dictation item and the settings item. The item SHALL be enabled only while an
undoable insertion record exists, and SHALL stay disabled in every other
session state, including while a transcript is in flight. Activating it SHALL
run the same guarded undo path as every other entry point and SHALL NOT send a
delete keystroke when the guard refuses.

#### Scenario: A live record enables the item

- **WHEN** a paste has just succeeded and the menu-bar menu is opened
- **THEN** 撤销上一次插入 is enabled
- **AND** the window, dictation, settings and quit items keep their existing
  positions and states

#### Scenario: No record disables the item

- **WHEN** no undoable record exists, or it was already undone
- **THEN** 撤销上一次插入 is disabled
- **AND** the menu still contains the four existing items in their order

#### Scenario: A refusal from the menu

- **WHEN** the user activates the item after the target changed
- **THEN** the refusal is reported and the recorded text is preserved in the
  result panel
- **AND** the target app receives no keystroke
