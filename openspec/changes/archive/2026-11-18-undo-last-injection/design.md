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

### 3. Deletion is one atomic script, guarded twice

`src/core/injection/delete.ts` owns the AppleScript, its argv builder and its
result parser; `src/main/injection.ts` supplies the `osascript` exec port. The
script re-reads the frontmost app, bundle, role, identity and editability and
presses `key code 51` only when every value matches the expected values passed
as separate argv items (never interpolated into the script). It re-reads app,
bundle, role and identity before every key; a change aborts with a
`*-mid-delete` result. A loop-body error returns `mid-delete-error`, while only
a pre-loop error returns `ERROR`. The app-level guard still runs first because
it also decides whether a still-running app should be activated, but the
script's own check is the one immediately before the keys.

`UndoLock` is the shared write mutex: deletions and every paste into a target
app take it. `createLockedPaste` waits a bounded 1.5 s for an in-flight
deletion, then proceeds or refuses with 撤销正在进行; it never writes while the
Backspace loop is running. A lock-busy refusal still writes the text to the
clipboard and shows the result panel with 「未插入到目标应用，已放入剪贴板与结果面板」
before the delivery reports the refusal, so the words are never only in a
history row. The lock is released in `finally` on every path, including exec
failures and thrown pastes.

The lock is not reentrant. The one branch that discovers a stale slot after it
already acquired the lock (a re-say fallback) passes `{ ...deliveryPorts(),
paste: pasteText }` so its delivery pastes directly instead of waiting 1.5 s on
itself and losing the new text.

The slot is marked consumed before the script starts; a concurrent request is
refused with 撤销正在进行. A script abort **before** the first key (app, bundle,
role or identity mismatch, or not-editable) restores the slot so the user can
retry. A mid-delete abort, loop-body error, exec error or timeout keeps the slot
consumed, is never retried, and tells the user the deletion may be incomplete.

`kind` must be `editable` for the guard to pass: a non-editable or unknown
target is a refusal, even if the app name matches. A record whose grapheme count
is `null` (no `Intl.Segmenter` at insertion time) is refused as
`unverifiable-length`; the delete path never falls back to code points.

### 4. Re-say snapshots the candidate at start, re-checks at delivery

`toggleRecording` reads the current slot when a recording starts inside the
window and stores it as the run's replace candidate (method `paste` only). At
delivery time main re-probes and runs the same `evaluateUndoGuard` against that
snapshot. On success it acquires the lock, clears the re-say snapshot in the
same critical section, consumes the slot, calls the atomic delete, then pastes
the new text. If the paste then fails, the old text is shown in the panel with
旧文本已删除，这里是备份. If the delete fails before any key, the slot is
restored for a retry but the new text is not pasted; a mid-delete failure keeps
the slot consumed and shows both texts with an incomplete-deletion warning. On
refusal or a concurrent undo it delivers the new text through the normal path
and shows the recorded text in the panel with 旧文本未删除.

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
3. Hide the panel, wait briefly, re-probe, and insert only when the target
   passes the same `compareTargetIdentity` the undo guard uses (same app, equal
   bundles when both are present, same role, and the same non-empty identity)
   and the element is editable.
4. Otherwise copy the edited text and name the reason.

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
- When the record has no bundle identifier, the bundle comparison is skipped;
  the app name, role and a non-empty element identity remain mandatory.
- Undo assumes the caret is at the end of the inserted text. If the user moves
  the caret within the same field, the fixed grapheme count deletes around the
  new caret position rather than the recorded span; this is a known limitation,
  not an exact-range restore.
- Smart punctuation or autocorrect in the target app can change the inserted
  text, so the recorded grapheme count can over- or under-delete.
- Reinsertion cannot reactivate the original app without a new Automation
  permission, so it degrades to copy whenever focus did not return after the
  panel was hidden. (B1 undo instead uses LaunchServices `open -b`, which adds
  no permission, and never for a closed app.)
- A paste that succeeds at the clipboard step but fails at the keystroke step
  leaves the old text deleted and the new text on the clipboard; the panel now
  shows the old text with 旧文本已删除，这里是备份, and the existing
  paste-permission error is still reported.
- The atomic script re-checks the frontmost app before every key, but a user can
  still switch apps in the microseconds between that check and the key. This is
  the smallest window AppleScript permits; the remaining risk is documented
  rather than hidden behind a second probe.
- A mid-delete abort or timeout is reported as 删除可能未完整完成 and the slot is
  consumed; the user must inspect the target and use the panel backup.
