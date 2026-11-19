## ADDED Requirements

### Requirement: The settings panel SHALL offer the 长句听写 choice honestly

The settings surface SHALL render a 长句听写 radio group with exactly three
choices — `auto` (`自动（超限才分段）`), `vad` (`按静音分段`), and `single`
(`整段不分`) — and SHALL show one short explanation for each choice. The row
SHALL use the existing settings classes and Chinese copy; it SHALL NOT
introduce a UI library. Adding the row SHALL NOT alter the vocabulary editor,
its draft state, its save path, or its starter-term action.

The row SHALL name the mode that is actually effective. When a valid
`JUSTSPEAK_SEGMENTED` is in charge, the panel SHALL disable the choices, select
the effective mode, and print `当前由环境变量接管（JUSTSPEAK_SEGMENTED=<value>）`.
When the variable is invalid, the panel SHALL print
`JUSTSPEAK_SEGMENTED 的值无效（<value>），已回退到设置中的「<档位名>」。`.
When a save is deferred, the panel SHALL print `已保存，下次启动生效；当前生效：<档位>。`.
The selected choice SHALL never disagree with the effective mode while an
environment takeover is shown.

#### Scenario: Default row

- **WHEN** the stored preference is `auto` and no env value is set
- **THEN** the `auto` choice is selected and its explanation is visible
- **AND** the row is labelled as the default

#### Scenario: Environment takeover

- **WHEN** `JUSTSPEAK_SEGMENTED=vad` is valid while the stored preference is `auto`
- **THEN** the `vad` choice is selected and the controls are disabled
- **AND** the exact takeover sentence with `vad` is shown

#### Scenario: Invalid environment value

- **WHEN** `JUSTSPEAK_SEGMENTED=loud` is rejected and the stored preference is `single`
- **THEN** the `single` choice is selected
- **AND** the exact fallback sentence naming `loud` and `整段不分` is shown
- **AND** the row is marked as a fallback rather than as a failure

#### Scenario: Deferred save

- **WHEN** a mode is saved while the pipeline is busy
- **THEN** the panel says the choice applies next launch and names the mode still running
- **AND** the recording is not interrupted
