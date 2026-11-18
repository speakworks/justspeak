## ADDED Requirements

### Requirement: The settings surface SHALL configure the undo window

The settings surface SHALL render an 撤销时间窗 row showing the current window
in minutes, defaulting to 5. The control SHALL accept an integer from 1 to 60
and SHALL write through the existing `preferences:set` surface as
`undoWindowMinutes`. The row SHALL report the value honestly: `default` at 5
minutes and `override` for any other accepted value. A rejected value SHALL be
reported inline, and the stored window SHALL remain unchanged.

#### Scenario: The default is shown

- **WHEN** the settings surface opens and no window has been saved
- **THEN** the row shows 5 分钟 and is labelled 默认

#### Scenario: A new window is saved

- **WHEN** the user enters 10 and the write is accepted
- **THEN** the row shows 10 分钟, labelled 已修改
- **AND** the next undo uses a 10-minute window

#### Scenario: An invalid window is rejected

- **WHEN** the user enters 0, 61, or a fraction
- **THEN** the surface reports the reason inline
- **AND** the stored value is not changed
