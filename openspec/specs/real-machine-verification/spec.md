# real-machine-verification Specification

## Purpose
TBD - created by archiving change os-level-verification. Update Purpose after archive.

## Requirements

### Requirement: Real-machine checks SHALL be opt-in and skipped by default

The real-machine harness SHALL run only when its own environment variable is
set: `JUSTSPEAK_REAL_AX=1` for `tests/e2e/undo-real-ax.spec.ts` and
`JUSTSPEAK_REAL_KEYS=1` for `tests/e2e/hotkey-real-keys.spec.ts`. With the
variable unset the whole file SHALL be skipped, so a plain `pnpm test`,
`pnpm e2e` or CI run keeps its current duration and needs no Accessibility,
Automation, or foreground window.

A skip SHALL NOT be recorded as a pass anywhere, and the harness SHALL NOT
silently swallow a missing permission: when the variable is set but the
environment cannot work (no Accessibility trust, no GUI session), the spec
SHALL fail and print which prerequisite is missing.

#### Scenario: The variable is unset

- **WHEN** the suite runs without `JUSTSPEAK_REAL_AX` or `JUSTSPEAK_REAL_KEYS`
- **THEN** no real-machine case executes and no GUI window is opened

#### Scenario: The variable is set but Accessibility is withheld

- **WHEN** `JUSTSPEAK_REAL_AX=1` and the process is not trusted for
  Accessibility
- **THEN** the spec fails with a message naming the missing grant
- **AND** it does not report the case as skipped or passed

### Requirement: The undo harness SHALL exercise the real delete script

The AX harness SHALL drive TextEdit through a temporary document and the real
`osascript` interpreter, not a shim, and it SHALL verify that undo removes
exactly the recorded number of grapheme clusters from the document text.

#### Scenario: Undo removes the recorded text

- **WHEN** a transcript is inserted into a TextEdit document and undo runs
  while the same document is frontmost
- **THEN** the document text is the original text with exactly the recorded
  grapheme count removed
- **AND** the remaining text matches the original byte for byte

#### Scenario: A foreground switch is refused

- **WHEN** the user switches to another application before undo
- **THEN** no delete keystroke is sent
- **AND** the recorded text is placed in the result panel
- **AND** the other application's text is unchanged

#### Scenario: A quit target is refused

- **WHEN** the target application has quit before undo
- **THEN** the undo is refused without sending a keystroke
- **AND** the recorded text is placed in the result panel

### Requirement: The keyboard harness SHALL use real system key events

The keyboard harness SHALL deliver key events through the system rather than
through Playwright's synthetic input, and it SHALL run against a dedicated
instance so that `Cmd+Q` can never reach an instance the user is using.

#### Scenario: The configured hotkey starts recording

- **WHEN** the real `Command+'` key event is delivered to the system
- **THEN** the application enters the recording state

#### Scenario: Quitting during recording is suppressed

- **WHEN** `Cmd+Q` is delivered while a dedicated instance is recording
- **THEN** that instance does not exit
- **AND** the user-visible message states that the shortcut is held by macOS
- **AND** the instance is terminated by the harness afterwards

### Requirement: Real-machine results SHALL be recorded honestly

`docs/REAL-MACHINE-CHECKS.md` SHALL record, for each real-machine item, the
machine, the macOS version, the date, the command used, and one of `pass`,
`fail`, or `blocked`. A `blocked` entry SHALL name the reason and the exact
command that would complete it. A skipped run SHALL never be written as `pass`.

#### Scenario: A blocked item is documented

- **WHEN** an item cannot run because the session has no usable GUI or the
  screen is locked
- **THEN** the entry is `blocked` with the reason and the follow-up command
- **AND** the change is not described as verified
