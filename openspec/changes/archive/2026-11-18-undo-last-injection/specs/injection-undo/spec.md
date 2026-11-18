## ADDED Requirements

### Requirement: The app SHALL keep exactly one undoable insertion record

After a transcript is delivered, main SHALL keep at most one in-memory
injection record. It SHALL be written only for a delivery whose method was a
real paste or the result panel, and it SHALL carry the target app name, the
focused element's role and identity as reported by the Accessibility probe,
the delivered text, its grapheme length, the insertion timestamp, the method,
and the history entry id once the entry exists. A newer delivery SHALL replace
the previous record; a successful undo SHALL clear it. Nothing SHALL be
persisted, so the slot does not survive a restart. A paste record whose element
identity is empty, or whose grapheme count could not be computed, SHALL remain
available to history but SHALL NOT be offered as undoable or used as a re-say
candidate, because the guard can never verify or size the deletion.

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
configured undo window; the recorded grapheme length is known; JustSpeak's own
window is not focused; the Accessibility probe reports the same target app as
the record; when both the record and the probe carry a bundle identifier, they
are equal; the probe reports an editable element whose role and identity match
the record; and both the record and the probe carry a non-empty element
identity. The number of Backspace keystrokes SHALL equal the recorded grapheme
length, and no other deletion method SHALL be used. If any guard fails, if the
element identity is empty on either side, if the grapheme count is unknown, or
if the probe cannot answer, the app SHALL send no delete keystroke at all. There
SHALL be no fallback to matching on app and role alone, and no fallback to
counting code points when grapheme segmentation is unavailable.

The final identity check and the keystrokes SHALL live in one Accessibility
script: the script SHALL re-read the frontmost app, bundle, role, identity and
editability, SHALL compare them against the expected values passed as separate
script arguments (never interpolated into the script text), and SHALL press a
key only when every value matches. It SHALL re-read app, bundle, role and
identity before every key and abort with a `*-mid-delete` result if any value
changes. A loop-body error SHALL return a distinct `mid-delete-error` result;
only an error before the loop SHALL return `ERROR`.

Every write into a target app — deletion and paste — SHALL hold one shared
write lock. A paste that starts while a deletion holds the lock SHALL wait a
bounded time, then proceed only after the deletion settles; if the wait
expires, it SHALL be refused with 撤销正在进行 and SHALL NOT write. It SHALL NOT
write while the Backspace loop is still running.

A paste refused because the lock is still held at the deadline SHALL NOT drop
the text: the app SHALL write it to the clipboard and place it in the result
panel with a notice that it was not inserted and is available in both. The
session SHALL report the refusal. A caller that already holds the write lock
SHALL NOT acquire it again; its fallback delivery SHALL paste directly. The
lock is not reentrant.

Only one guarded deletion SHALL be in flight. The slot SHALL be marked consumed
before the script starts; a second concurrent request SHALL be refused without
sending a key, and a request whose slot was already consumed or replaced SHALL
also be refused. A script abort before the first key (app, bundle, role or
identity mismatch, or not-editable) SHALL restore the slot so the user can
retry. A mid-delete abort, loop-body error, exec error or timeout SHALL keep the
slot consumed, SHALL NOT be retried, and SHALL tell the user the deletion may be
incomplete.

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

#### Scenario: The element identity is not verifiable

- **WHEN** either the record or the fresh probe has an empty element identity
  (the element exposes neither `AXIdentifier` nor `AXTitle`)
- **THEN** no delete keystroke is sent
- **AND** the refusal is labelled 无法确认输入位置
- **AND** the recorded text is placed in the result panel for copying
- **AND** the app does not fall back to matching on app and role alone

#### Scenario: The app name matches but the bundle differs

- **WHEN** both the record and the probe carry a bundle identifier and they
  differ, even though the app names match
- **THEN** no delete keystroke is sent

#### Scenario: The target changes between the probe and the script

- **WHEN** the app-level probe passed but the frontmost app, bundle, role or
  identity has changed by the time the atomic script runs, before any key
- **THEN** the script presses no key
- **AND** the slot is restored so the user can retry
- **AND** the recorded text is placed in the result panel with 撤销未完成

#### Scenario: Two undo requests overlap

- **WHEN** two entry points invoke undo during the same probe delay
- **THEN** exactly one sends the recorded count of Backspace keystrokes
- **AND** the other is refused with 撤销正在进行 and sends no key

#### Scenario: A paste arrives while a deletion is running

- **WHEN** any paste path starts while the shared write lock is held by a
  deletion
- **THEN** the paste waits for a bounded time
- **AND** it writes only after the deletion settles, so the tail Backspaces
  cannot delete the new text
- **AND** if the wait expires, the paste is refused with 撤销正在进行 and writes
  nothing

#### Scenario: A paste times out on the write lock

- **WHEN** a paste's bounded wait expires because a deletion is still running
- **THEN** the text is written to the clipboard
- **AND** it is placed in the result panel with a notice that it was not
  inserted into the target app and is available in the clipboard and panel
- **AND** the session reports the refusal

#### Scenario: A fallback runs while the caller already holds the lock

- **WHEN** a re-say delivery acquires the lock and then discovers its slot was
  already consumed or replaced
- **THEN** its fallback delivery pastes directly without acquiring the lock again
- **AND** the new text is inserted (or placed in the panel), never lost to a
  self-wait timeout

#### Scenario: A loop-body error is distinct from a pre-loop error

- **WHEN** the per-key re-check or the key press raises an error inside the loop
- **THEN** the script returns `mid-delete-error`, not `ERROR`
- **AND** the slot is consumed because presses may already have happened
- **AND** a pre-loop `ERROR` is still treated as possibly incomplete

#### Scenario: Deletion fails or is only partly completed

- **WHEN** the atomic script aborts mid-delete, errors inside the loop, times
  out, or fails to execute
- **THEN** the slot is consumed and cannot be retried
- **AND** the user is told the deletion may be incomplete
- **AND** the recorded text is preserved in the result panel

#### Scenario: The grapheme count is unavailable

- **WHEN** the runtime cannot compute grapheme clusters for the recorded text
- **THEN** no delete keystroke is sent
- **AND** the refusal is labelled 无法计算删除长度
- **AND** the recorded text is placed in the result panel for copying

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
when the slot's method was a paste and its element identity is verifiable. When
that run's transcript is ready, main
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
- **AND** the old text is shown in the result panel with the notice
  「旧文本已删除，这里是备份」
- **AND** the existing paste-permission error is reported and the new text is
  left on the clipboard

#### Scenario: The old-text deletion fails during re-say

- **WHEN** the atomic script errors, times out, aborts, or partially deletes
- **THEN** the slot is consumed and cannot be retried
- **AND** the new text is not pasted into the target
- **AND** the panel shows both the new and old text with a notice that the
  deletion may be incomplete

### Requirement: The result panel SHALL support editing and reinsertion

The result panel's text SHALL be a controlled editable field. It SHALL offer
重新插入, which sends the edited text to main. Main SHALL validate the text,
rewrite the matching history row in place when the panel carries a history
entry id, and then, after hiding the panel, insert the text only when the
current target passes the same identity comparison the undo guard uses: same
app, equal bundle identifiers when both are present, same role, and a non-empty
element identity equal to the one recorded when the panel was shown. Reinsertion
SHALL NOT use a separate app-only check. When the comparison fails, or the
element is not editable, main SHALL copy the edited text to the clipboard
instead and SHALL name the reason. The edited text SHALL replace the history
row's text; the app SHALL NOT keep a separate copy of the pre-edit text.

#### Scenario: Reinsert into the original target

- **WHEN** the user edits the panel and activates 重新插入 while the original
  app and the same verifiable element are editable again
- **THEN** the edited text is pasted into that element
- **AND** the history row for that delivery shows the edited text

#### Scenario: Focus is no longer valid

- **WHEN** the probe reports a different app, bundle, role or identity, an empty
  identity, or a non-editable or unknown element at reinsert time
- **THEN** no keystroke is sent
- **AND** the edited text is copied to the clipboard and the notice names the
  reason

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

### Requirement: Undo SHALL document its bundle and caret assumptions

When the expected bundle id is empty, the bundle comparison SHALL be skipped;
the app name, role and a non-empty element identity SHALL still be mandatory.
Undo SHALL assume the caret remains at the end of the inserted text. If the user
moves the caret within the same field, the fixed grapheme count deletes around
the new caret position rather than the recorded span. This assumption SHALL be
documented as a known limitation and not presented as restoring an exact range.

#### Scenario: The bundle id is unavailable

- **WHEN** the record has no bundle identifier
- **THEN** the bundle comparison is skipped
- **AND** the app name, role and non-empty identity are still required

#### Scenario: The caret moved

- **WHEN** the user moves the caret within the same field after the insertion
- **THEN** undo still deletes the recorded grapheme count from the current
  caret position
- **AND** this is documented as a limitation rather than an exact-span promise
