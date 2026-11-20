## ADDED Requirements

### Requirement: The focus probe SHALL report the real selection range or say it is unreadable

The Accessibility probe SHALL read the focused element's `AXSelectedTextRange`
and SHALL expose both the range `location` and its `length` on the target as a
non-null selection only when both numeric values were actually read. When the
attribute is absent, returns `kAXErrorNoValue`, or its value cannot be parsed,
the probe SHALL report the selection as `null` together with a reason. It SHALL
NOT substitute `0` for a failed read, because `0` is a valid caret position and
would make the guard believe the caret sits at the start of the field.

The editability decision SHALL keep using whether a text selection range is
available: an absent range means the element is not editable, while a present
range whose numbers cannot be parsed remains editable with an unreadable
selection.

#### Scenario: The probe reads a collapsed caret

- **WHEN** the focused element exposes `AXSelectedTextRange` with location 12
  and length 0
- **THEN** the target carries `selection: { location: 12, length: 0 }`
- **AND** the value is distinguishable from an unreadable selection

#### Scenario: The probe reads a non-empty selection

- **WHEN** the focused element exposes `AXSelectedTextRange` with location 4
  and length 3
- **THEN** the target carries `selection: { location: 4, length: 3 }`

#### Scenario: The range value is unreadable

- **WHEN** `AXSelectedTextRange` is present but its value cannot be read or
  parsed
- **THEN** the target's `selection` is `null`
- **AND** the target does not report a fabricated location of 0

#### Scenario: The range attribute is absent

- **WHEN** the focused element has no `AXSelectedTextRange`
- **THEN** the target is not editable
- **AND** its `selection` is `null`

### Requirement: Undo SHALL delete only the span this app inserted and SHALL cap the rollback

When an insertion is recorded, the app SHALL store the pre-paste insertion
point `P0`, the pre-paste selection length `S`, and the inserted grapheme count
`N`. `P0` and `S` come from the same probe that approved the paste and SHALL be
`null` when that probe could not read them.

Before any Backspace, the app SHALL re-read the target's current selection and
SHALL send exactly `N` Backspaces only when the current selection length is 0
and its location equals `P0 + A`, where `A` is the inserted text's advance in
the target's caret units (UTF-16 code units on macOS, equal to `N` for text
without surrogate pairs). The active-selection check SHALL run before any
unreadable-value branch: when the current selection length is greater than 0
the app SHALL refuse even if `P0` was never recorded.

A location that differs, a selection length greater than 0, an unreadable
current selection, or a missing `P0`/`S` SHALL send no Backspace at all and
SHALL refuse with a visible message. There SHALL be no conservative
"delete a few anyway" path. An unreadable caret SHALL be reported as
`caret-unverified` with the message `无法确认插入位置，未回退`, and the app SHALL
log whether the insertion-time value or the current value was missing. The
recorded text SHALL remain available in the result panel.

The rollback count SHALL be capped by the fixed constant
`MAX_UNDO_CHARS = 500`. A record whose grapheme count exceeds the cap SHALL be
refused with a visible message before any key is pressed. The cap SHALL NOT be
stored in or read from preferences, and SHALL NOT be configurable.

#### Scenario: The caret is still at the end of the insertion

- **WHEN** the record has `P0 = 10`, `N = 4`, and the current selection is
  location 14, length 0
- **THEN** the app sends exactly 4 Backspaces

#### Scenario: A selection existed before the paste

- **WHEN** the record has a pre-paste selection of length `S > 0` at `P0` and
  the current selection is location `P0 + A`, length 0
- **THEN** the app sends exactly `N` Backspaces, because a paste replaces the
  selection and leaves the caret after the inserted text

#### Scenario: The user typed after the insertion

- **WHEN** the current caret location is not `P0 + A` with a collapsed
  selection
- **THEN** no Backspace is sent
- **AND** the user sees a refusal naming the changed insertion point
- **AND** the recorded text stays available in the result panel

#### Scenario: The user selected text

- **WHEN** the current selection length is greater than 0
- **THEN** no Backspace is sent
- **AND** the user sees a refusal naming the active selection

#### Scenario: The caret value is unreadable at undo time

- **WHEN** the target is still editable but its current selection cannot be
  read
- **THEN** no Backspace is sent
- **AND** the refusal is `caret-unverified` with `无法确认插入位置，未回退`
- **AND** a log entry names the unreadable current selection

#### Scenario: The insertion point was unreadable at paste time

- **WHEN** the record has `P0` equal to `null`
- **THEN** no Backspace is sent
- **AND** the refusal is `caret-unverified` with `无法确认插入位置，未回退`
- **AND** a log entry names the missing insertion point

#### Scenario: A selection wins over an unreadable insertion point

- **WHEN** the record has `P0` equal to `null` and the user has selected text
  inside the field
- **THEN** the refusal is `selection-active`, not `caret-unverified`
- **AND** no Backspace is sent, so the selection cannot be wiped by one key

#### Scenario: The record exceeds the fixed cap

- **WHEN** the recorded grapheme count is greater than 500
- **THEN** no Backspace is sent
- **AND** the user sees a refusal stating that the rollback exceeds the
  single-operation limit

#### Scenario: The cap is a constant

- **WHEN** the app reads its configuration
- **THEN** `MAX_UNDO_CHARS` is the fixed value 500
- **AND** no preference key can change it

### Requirement: A switched or exited target SHALL be refused by name

Before deleting, the app SHALL verify that the target process is still running
and that the frontmost focused element is still the recorded target. When the
process is gone, another app is frontmost, the focused element changed, or the
probe cannot read the app at all, the app SHALL send no Backspace and SHALL
show exactly `目标已切走，未回退` in the result panel. This sentence SHALL be
identical for a probe-stage mismatch (`app-changed`, `focus-changed`,
`unverifiable-target`) and for an atomic-script pre-key mismatch
(`app-changed`, `bundle-changed`, `role-changed`, `identity-changed`). A closed
app SHALL NOT be launched to satisfy the check. There SHALL be no silent
fallback that presses keys into the new target. The re-say path SHALL use the
same sentence when its target changed.

When the change is detected inside the keystroke loop, at least one key may
already have been pressed. That case SHALL keep the "possibly incomplete"
meaning and SHALL use the exact text
`删除过程中目标已切走，删除可能未完整完成` instead.

#### Scenario: Another app became frontmost

- **WHEN** the recorded app is no longer frontmost before undo starts
- **THEN** no Backspace is sent
- **AND** the result panel shows exactly `目标已切走，未回退`
- **AND** the recorded text remains available for copying

#### Scenario: The recorded app quit

- **WHEN** the recorded app is no longer running
- **THEN** no app is launched and no Backspace is sent
- **AND** the result panel shows exactly `目标已切走，未回退`

#### Scenario: Focus moved inside the same app

- **WHEN** the same app is frontmost but the focused element no longer matches
  the record
- **THEN** no Backspace is sent
- **AND** the result panel shows exactly `目标已切走，未回退`

#### Scenario: The atomic script refuses before the first key

- **WHEN** the app, bundle, role or identity no longer matches inside the
  delete script, before any key is pressed
- **THEN** the script returns the corresponding pre-key mismatch
- **AND** the result panel shows exactly `目标已切走，未回退`

#### Scenario: The target changes after a key was pressed

- **WHEN** the frontmost app, bundle, role, identity or caret changes inside the
  key loop
- **THEN** the script stops pressing keys
- **AND** the result panel shows exactly `删除过程中目标已切走，删除可能未完整完成`
  for a target change, or the matching caret sentence for a caret drift
- **AND** the slot stays consumed and is not retried
