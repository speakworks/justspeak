## ADDED Requirements

### Requirement: Undo SHALL be reachable from the app menu and the result panel

The application menu's 听写 submenu SHALL offer 撤销上一次插入, and the
menu-bar icon menu SHALL offer the same action. The item SHALL be enabled only
while an undoable record exists. The result panel SHALL offer 撤销上一次插入 as
well, so a user who reached the panel can still undo without finding the menu.
Activating an entry point SHALL run the same guarded undo path used everywhere
else and SHALL report a refusal without sending a delete keystroke.

#### Scenario: The app menu exposes undo

- **WHEN** a paste has just succeeded and the user opens the 听写 menu
- **THEN** 撤销上一次插入 is enabled
- **AND** activating it runs the guarded undo path

#### Scenario: Nothing to undo

- **WHEN** no injection record exists or it was already undone
- **THEN** the menu item is disabled
- **AND** invoking the panel action reports that there is nothing to undo

#### Scenario: A refusal is reported

- **WHEN** the user invokes undo after switching apps
- **THEN** the refusal is reported and the recorded text is preserved in the
  result panel
