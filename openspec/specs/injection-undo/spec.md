# injection-undo Specification

## Purpose
TBD - created by archiving change undo-last-injection. Update Purpose after archive.

## Requirements

### Requirement: The app SHALL keep exactly one undoable insertion record

After a transcript is delivered, main SHALL keep at most one in-memory
injection record. It SHALL be written only for a delivery whose method was a
real paste or the result panel, and it SHALL carry the target app name, the
focused element's role and identity as reported by the Accessibility probe,
the delivered text, its grapheme length, the insertion timestamp, the method,
and the history entry id once the entry exists. A newer delivery SHALL replace
the previous record; a successful undo SHALL clear it. Nothing SHALL be
persisted, so the slot does not survive a restart.

The character length SHALL count grapheme clusters, not UTF-16 code units, so
one Backspace removes one visible character.

#### Scenario: A paste records the guarded insertion

- **WHEN** a transcript is pasted into an editable frontmost element
- **THEN** the slot holds that text, its grapheme count, the frontmost app name,
  the focused element's role and identity, and the insertion time
- **AND** the matching history row id is attached once history has been written

#### Scenario: A newer insertion replaces the slot

- **WHEN** a second transcript is pasted before the first is undone
- **THEN** the slot describes only the second insertion
- **AND** the first insertion is no longer offered for undo

#### Scenario: A non-paste delivery does not create a delete target

- **WHEN** delivery used the app's own input, or the paste step failed
- **THEN** no new delete target is recorded

### Requirement: Automatic deletion SHALL require every guard

The app SHALL send a delete keystroke only when all of the following hold:
the record exists and its method was a paste; the current time is within the
configured undo window; JustSpeak's own window is not focused; the
Accessibility probe reports the same target app as the record; the probe
reports an editable element whose role and identity match the record. The
number of Backspace keystrokes SHALL equal the recorded grapheme length, and
no other deletion method SHALL be used. If any guard fails, or the probe cannot
answer, the app SHALL send no delete keystroke at all.

Because invoking undo from JustSpeak's own menu, panel, or history makes
JustSpeak frontmost, the action SHALL first bring a still-running recorded app
back to the front through the OS application-launching service (not Apple
Events), wait briefly, and then run the guard. It SHALL NOT launch an app that
is no longer running: a closed target is a refusal. The final decision SHALL
still be made on a fresh probe after the app is frontmost.

#### Scenario: The same editable target is still frontmost

- **WHEN** the user invokes undo while the same app and focused element from
  the insertion are still frontmost and editable, inside the window
- **THEN** main sends exactly the recorded grapheme count of Backspace
  keystrokes
- **AND** the slot is cleared

#### Scenario: The recorded app is running but not frontmost

- **WHEN** the user invokes undo from JustSpeak's menu or history while the
  recorded app still runs in the background
- **THEN** the app is brought to the front without Apple Events
- **AND** the guard is re-run on a fresh probe before any keystroke is sent

#### Scenario: A different app is frontmost and the recorded app is gone

- **WHEN** the recorded app is no longer running when undo is invoked
- **THEN** no app is launched
- **AND** no delete keystroke is sent
- **AND** the recorded text is placed in the result panel for copying

#### Scenario: The focused element changed inside the same app

- **WHEN** the target app is frontmost but the probe reports a different role
  or identity than the record
- **THEN** no delete keystroke is sent
- **AND** the refusal is surfaced with the text preserved in the panel

#### Scenario: The target can no longer be probed

- **WHEN** the probe returns `unknown` or `non-editable`
- **THEN** no delete keystroke is sent

#### Scenario: The window has expired

- **WHEN** the configured undo window has elapsed since the insertion
- **THEN** no delete keystroke is sent
- **AND** the user is told the window expired

#### Scenario: The record came from the panel

- **WHEN** the recorded method is the result panel
- **THEN** no delete keystroke is sent, because no text was inserted into a
  target app
- **AND** the user is told there is nothing to remove

### Requirement: A refused undo SHALL preserve the text

When a guard refuses an undo and an injection record exists, the app SHALL show
the recorded text in the result panel with a title naming the reason (for
example 已切换目标 or 已超过撤销时间窗) so the text remains copyable. A refusal
SHALL NOT leave any partial deletion behind.

#### Scenario: Refusal reopens the panel

- **WHEN** an undo is refused because the target changed
- **THEN** the result panel shows the recorded text and the refusal reason
- **AND** the target app receives no keystroke

### Requirement: Re-say SHALL replace the previous insertion as one operation

Starting a new dictation inside the undo window SHALL mark the run as re-say
when the slot's method was a paste. When that run's transcript is ready, main
SHALL re-run the same guard implementation used by undo. On success it SHALL
first delete the recorded grapheme count, then paste the new text, and the new
insertion SHALL become the slot. On refusal it SHALL deliver only the new text,
SHALL state that the old text was not deleted, and SHALL place the old text in
the result panel. It SHALL NOT leave the old and new text silently duplicated in
the target app.

#### Scenario: Guard passes

- **WHEN** the re-say transcript is ready and the guard still passes
- **THEN** the old text is deleted by exactly the recorded count
- **AND** the new text is pasted once
- **AND** the slot now describes the new insertion

#### Scenario: Guard refuses

- **WHEN** the re-say transcript is ready but the app or focused element changed
- **THEN** only the new text is delivered
- **AND** the old text is shown in the result panel with the notice 旧文本未删除
- **AND** no delete keystroke is sent

#### Scenario: The new paste fails after deletion

- **WHEN** deletion succeeded and the subsequent paste keystroke fails
- **THEN** the slot is already cleared, so undo cannot target deleted text
- **AND** the existing paste-permission error is reported and the new text is
  left on the clipboard

### Requirement: The result panel SHALL support editing and reinsertion

The result panel's text SHALL be a controlled editable field. It SHALL offer
重新插入, which sends the edited text to main. Main SHALL validate the text,
rewrite the matching history row in place when the panel carries a history
entry id, and then, after hiding the panel, insert the text only when the probe
reports the same app as when the panel was shown and an editable element. When
that check fails, main SHALL copy the edited text to the clipboard instead. The
edited text SHALL replace the history row's text; the app SHALL NOT keep a
separate copy of the pre-edit text.

#### Scenario: Reinsert into the original target

- **WHEN** the user edits the panel and activates 重新插入 while the original
  app again reports an editable focused element
- **THEN** the edited text is pasted into that app
- **AND** the history row for that delivery shows the edited text

#### Scenario: Focus is no longer valid

- **WHEN** the probe reports a different app, or a non-editable or unknown
  element, at reinsert time
- **THEN** no keystroke is sent
- **AND** the edited text is copied to the clipboard and a notice says so

#### Scenario: History cannot be rewritten

- **WHEN** the history update fails
- **THEN** the failure is logged
- **AND** reinsertion or copying still proceeds

### Requirement: The undo window SHALL default to five minutes and be configurable

The undo window SHALL default to 5 minutes and SHALL be configurable as an
integer number of minutes from 1 to 60 through the settings surface. The value
SHALL be stored in `preferences.json` through the existing merge path, and an
invalid value SHALL be rejected without writing any part of the patch.

#### Scenario: Default window

- **WHEN** no window preference has been saved
- **THEN** an insertion remains undoable for 5 minutes

#### Scenario: Invalid window is rejected

- **WHEN** a patch requests zero, a negative number, a fraction, or a value
  above 60 minutes
- **THEN** the whole patch is rejected with a reason
- **AND** the stored window is unchanged
