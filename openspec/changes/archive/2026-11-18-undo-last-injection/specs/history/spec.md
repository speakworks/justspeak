## ADDED Requirements

### Requirement: History SHALL support in-place edits and an undo entry point

A history row SHALL be rewritable in place with the result panel's edited text,
without creating a second entry and without retaining the pre-edit text. The
row whose id matches the current injection record SHALL offer the guarded
undo action (labelled 撤销插入, performing 撤销上一次插入) when the record is
undoable; other rows SHALL NOT show that action. Activating it SHALL run the
same guarded undo path and SHALL report a refusal instead of deleting text in a
different target.

#### Scenario: Editing rewrites the row

- **WHEN** the user edits a transcript in the result panel and reinserts it
- **THEN** the matching history row's text becomes the edited text
- **AND** the entry count and creation time do not change
- **AND** no copy of the original text is kept

#### Scenario: The undo action appears on the matching row

- **WHEN** a paste has just succeeded and the history pane is open
- **THEN** the row for that insertion offers the 撤销插入 action
- **AND** after the undo succeeds the action disappears

#### Scenario: A refusal is reported from history

- **WHEN** the user activates the row action after the target changed
- **THEN** the pane reports the refusal
- **AND** the recorded text remains available in the result panel
