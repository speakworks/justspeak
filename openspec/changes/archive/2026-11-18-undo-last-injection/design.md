## Context

`src/core/shell/delivery.ts` already chooses `insert` / `paste` / `panel` from
two facts: whether JustSpeak's own window is focused, and what the Accessibility
probe says about the frontmost focused element (`src/core/focus/editability.ts`,
`src/main/focus-probe.ts`). `src/main/index.ts` wires that decision into the
session's paste stage and records history afterwards. The result panel is a
non-activating `panel` window (`src/main/result-panel.ts`) whose text is
read-only.

The correction path must reuse this boundary rather than invent a second one.
The focus probe is the only component that can answer "is the same editable
target still in front of the user", so every guard decision is built on it.

## Goals / Non-Goals

### Goals

- One in-memory slot, no new persisted file.
- One pure guard implementation shared by B1 undo, B2 re-say, and the reinsert
  check. B2 must not reimplement any part of it.
- The delete action is a separate, injectable port so tests never spawn
  `osascript`.
- The result panel remains non-activating on show, so the target app stays
  frontmost and B1's guard can succeed right after a paste.

### Non-Goals

- Undo of the app's own home-input insertion.
- A history of injections or a redo action.
- Changing the panel's window type or adding a new system permission.

## Decisions

### 1. Extend the focus probe instead of adding a second probe

`FocusTarget` grows from a three-state `FocusKind` to a record:

```ts
interface FocusTarget {
  kind: FocusKind
  appName: string | null   // frontmost process name
  bundleId: string | null  // best effort, used only by the panel path
  role: string | null      // AX role of AXFocusedUIElement
  identity: string         // AXIdentifier, else AXTitle, else ''
}
```

The AppleScript still runs through System Events, so it adds no permission. The
wire format becomes five newline-separated fields; `parseFocusProbeLine` keeps
its old two-field contract and `parseFocusProbeTarget` handles the new one, so
existing delivery tests and their shims do not change.

The guard compares `appName`, `role`, and `identity`, and requires a non-empty
identity on both the record and the fresh probe. An empty `AXIdentifier` and
`AXTitle` mean the target cannot be distinguished from another field with the
same role in the same app, so the guard refuses automatic deletion rather than
falling back to app-plus-role matching. A bundle-id mismatch, when both sides
carry one, is also a refusal. `kind` must be `editable`.

### 2. One pure guard, one slot

`src/core/injection/undo.ts` owns:

- `InjectionRecord` (app, role, identity, text, grapheme length, timestamp,
  method, optional history entry id);
- `graphemeLength` using `Intl.Segmenter` with a code-point fallback;
- `buildInjectionRecord`;
- `evaluateUndoGuard`, returning either `{ ok: true, count }` or a typed
  refusal (`no-record` / `expired` / `nothing-inserted` / `app-changed` /
  `focus-changed`) with a user-facing message.

Main stores exactly one record in memory. A successful paste replaces it; a
successful undo clears it. Nothing is persisted, so quitting the app forgets
the slot.

### 3. Deletion is a guarded port, never a fallback

`src/main/injection.ts` gains `deleteCharacters(count)` which sends
`key code 51` (Backspace) exactly `count` times through the same System Events
path the paste already uses. It is called only after `evaluateUndoGuard`
returns `ok`, and only with the recorded grapheme count. If the probe cannot
answer, or the app/role/identity changed, the code path shows the panel and
sends no key at all.

`kind` must be `editable` for the guard to pass: a non-editable or unknown
target is a refusal, even if the app name matches.

### 4. Re-say snapshots the candidate at start, re-checks at delivery

`toggleRecording` reads the current slot when a recording starts inside the
window and stores it as the run's replace candidate (method `paste` only). At
delivery time main re-probes and runs the same `evaluateUndoGuard` against that
snapshot. On success it clears the slot, deletes the recorded count, then pastes
the new text. On refusal it delivers the new text through the normal path,
shows the recorded text in the panel with the title 旧文本未删除, and reports the
refusal. The slot is cleared before the new paste so a failed paste cannot
leave a stale delete target pointing at already-deleted text.

### 5. Result panel becomes editable but stays non-activating

`focusable` is enabled so a click can type into the panel, but it is still
shown with `showInactive()`, so a panel that appears after a failed paste does
not steal focus. The payload grows optional `title` and `notice` fields, used
for the refusal and re-say messages.

Reinsertion:

1. Take the edited text from the renderer and validate it in main.
2. Rewrite the matching history row in place when the panel still carries the
   history entry id (best effort; a failed write is logged and does not block
   insertion).
3. Hide the panel, wait briefly, re-probe, and insert only when the probe names
   the same app as when the panel was shown and reports an editable element.
4. Otherwise copy the edited text and show a short notice.

The panel's original target app/bundle is captured from the delivery probe; it
is never used to activate another app through AppleScript, which would require
a new Automation authorization.

### 6. Time window is a preference, but the guard reads a cached value

`preferences.json` gains `undoWindowMinutes` (integer 1–60, default 5) through
the existing merge path. Main keeps a cached copy so the guard does not need an
async disk read on the keystroke path; the preference write updates it.

### 7. Explicit undo brings a running recorded app forward

Every in-app entry point (app menu, menu-bar menu, result panel, history row)
makes JustSpeak frontmost by the time it runs, so applying the app guard
without restoring the recorded app would make undo always refuse. The action
therefore activates the recorded app only when the OS reports that it is still
running, using `open -b` (LaunchServices, no Apple Events and no new
Automation authorization), waits briefly, and re-probes. The full guard still
runs on that fresh probe, so a moved focus is refused. A closed app is never
launched; it falls back to the panel. Re-say does not activate anything: it is
started by the global hotkey, which leaves the target app frontmost, and a
changed target correctly lands on the refusal path.

## Known limitations

- Element identity is frequently absent. When an element exposes neither
  `AXIdentifier` nor `AXTitle`, automatic deletion is refused and the text is
  preserved in the result panel; there is no app-plus-role fallback. This is a
  deliberate capability loss in exchange for never deleting the wrong span.
- Smart punctuation or autocorrect in the target app can change the inserted
  text, so the recorded grapheme count can over- or under-delete.
- Reinsertion cannot reactivate the original app without a new Automation
  permission, so it degrades to copy whenever focus did not return after the
  panel was hidden. (B1 undo instead uses LaunchServices `open -b`, which adds
  no permission, and never for a closed app.)
- A paste that succeeds at the clipboard step but fails at the keystroke step
  leaves the old text deleted and the new text on the clipboard; the session
  still reports the existing paste-permission error.
