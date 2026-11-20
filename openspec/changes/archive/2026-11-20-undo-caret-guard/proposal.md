## Why

The current undo path deletes a fixed grapheme count from whatever caret the
target app happens to have. That is correct only while the caret still sits at
the end of the text JustSpeak inserted. If the user types after the insertion,
moves the caret, or selects text, the same count removes the user's own
characters instead of the recorded span, and no guard can tell because the
Accessibility probe only reported whether a selection range existed
(`hasRange` 0/1), never its location or length.

The target can also change between the guard probe and the keystroke loop. The
atomic AppleScript already re-checks app, bundle, role, identity and
editability before every key, but a target that switched away or quit after a
passing probe must still produce a named, visible refusal rather than a silent
delete attempt.

## What Changes

- **The focus probe reports the real selection range.** `AXSelectedTextRange`
  is read as `location` and `length` and carried on `FocusTarget.selection` for
  the undo path. When the attribute or its value cannot be read, the probe
  reports an explicit unreadable state (`null`), never `0`, so a caret at
  position 0 cannot be confused with a failed read.
- **Undo deletes only our own span.** The insertion record now keeps the
  pre-paste insertion point `P0`, the pre-paste selection length `S`, and the
  inserted grapheme count `N`. Before a delete, the guard re-reads the current
  AX selection and deletes exactly `N` characters only when the caret is
  collapsed and its `location` equals `P0 + A`, where `A` is the inserted
  text's UTF-16 advance (equal to `N` for text without surrogate pairs). A
  different location, an active selection, or an unreadable-at-decision-time
  probe produces a named refusal or the existing conservative path, never an
  unconditional Backspace loop.
- **A fixed 500-character cap.** `MAX_UNDO_CHARS = 500` is a hard constant, not
  a preference. A record longer than the cap is refused with a visible message.
- **Unreadable values stay conservative.** When the selection range cannot be
  read, the deletion keeps the existing behaviour (press at most `N`
  Backspaces) and logs the reason. It never deletes more than `N`.
- **A switched or exited target is refused by name.** When the target process
  is gone or focus moved, no Backspace is sent and the result panel shows
  `目标已切走，未回退`.

## Goals

- An insertion that was edited after the fact cannot be silently over-deleted.
- The caret decision is pure logic in `src/core`, unit-tested with an injected
  fake AX reading; Electron only supplies probes and keystrokes.
- The cap is enforced in one constant with tests, and is not configurable.

## Non-Goals

- Multi-level undo, an undo stack, or exact-range restoration.
- Reading or editing user preferences; the cap is fixed at 500.
- Changing paste, re-say delivery, history, or the result panel's edit flow
  beyond the refusal wording.
- Windows or Linux support.

## Risks

- **Selection units differ across apps.** `AXSelectedTextRange` is reported in
  UTF-16 code units, while the record counts grapheme clusters. The guard
  compares only the caret location and deletes `N` graphemes; an app that
  reports a different unit will fail the location check and refuse, which is
  the safe direction.
- **A caret that legitimately moved but still points at our span.** The guard
  refuses rather than trying to prove ownership, per the frozen decision that
  only the inserted span may be removed.
- **Conservative fallback can under-delete.** When the value is unreadable the
  app presses `N` Backspaces from the current caret; if the user typed first,
  the visible result may be wrong, but it never deletes more than `N` and the
  reason is logged.
