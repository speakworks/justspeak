## Why

Dictation is only useful when a bad insertion is cheap to correct. Today the
app has no correction path at all: once a transcript is pasted into another
app, the only recovery is manual selection and deletion, and a result panel
shown because the focus could not accept text is read-only. That makes every
recognition mistake a multi-step manual repair on the user's side.

The correction path must be cross-app, so it is also the highest-risk feature
in the product: an unconditional Backspace/Delete keystroke would delete text
in whichever window happens to be frontmost. The design therefore treats
"delete" as a guarded, last-resort action rather than a default.

## What Changes

- **B1 — undo the last insertion.** On a successful paste, main records one
  single-slot injection record: target app identity, insertion method, inserted
  text, character length, insertion time, and the focused element identity
  reused from the Accessibility focus probe. An explicit 撤销上一次插入 action
  deletes exactly the recorded count only when every guard passes; otherwise it
  never synthesises a delete key and instead puts the recorded text back into
  the result panel for copying.
- **B2 — re-say replaces the previous insertion.** Starting dictation again
  inside the same undo window enters re-say mode. When the new transcript is
  ready, the same guard implementation decides whether the old text may be
  deleted; if it may, deletion and the new paste form one operation. If it may
  not, only the new text is delivered, the user is told 旧文本未删除, and the old
  text is placed in the result panel. There is never a second copy of the old
  text left silently in the target app.
- **B3 — edit and reinsert from the result panel.** The panel's text becomes
  a controlled editable field and gains 重新插入. If the original target app is
  valid, the edited text is pasted there; otherwise the action degrades to
  copy. An edited text rewrites the matching history row in place.
- **Settings.** The undo window is configurable, defaulting to 5 minutes.
- **Entry points.** The macOS app menu, the menu-bar icon menu, the result
  panel, and the matching history row each expose 撤销上一次插入.

## Goals

- A wrong insertion can be undone without leaving the target app or using the
  mouse, and a second dictation can replace the first without duplicates.
- No code path sends a delete key unless the recorded app and focused element
  still match the insertion, the element is still editable, the method was a
  real paste, and the undo window has not expired.
- The guard decision, the time window, and the single-slot state live in
  `src/core` and are unit-tested; Electron only supplies probes and keystrokes.
- The result panel can be edited and reinserted without a second persisted
  copy of the original transcript.

## Non-Goals

- Multi-level undo or an undo stack. Exactly one insertion is remembered.
- Undoing insertions the app made into its own home input; that surface is
  already editable and has its own caret.
- A system-wide clipboard-history integration.
- Synthesising Cmd+Z in the target app. Undo is a deletion of a known count,
  not a request that another app interpret its own undo semantics.
- Windows/Linux support.

## Risks

- **Element identity is not always exposed.** Accessibility often omits
  `AXIdentifier` and `AXTitle`. The guard requires a non-empty identity on both
  sides and treats an empty one as unverifiable, so automatic deletion is
  refused and the text goes to the result panel. There is no app-plus-role
  fallback; the capability loss is the price of never deleting the wrong span.
- **Autocorrect or smart punctuation can change the inserted text.** The
  recorded grapheme count may then delete too much or too little. The feature
  is deliberately single-level and time-bounded so the blast radius is one
  utterance.
- **Target app closed or focus moved.** Both are treated as refusals, never as
  "try anyway"; the text is preserved in the panel.
- **Concurrency and partial deletion.** Two entry points can overlap during the
  probe delay, and a script can time out after some keys. A single-flight lock
  admits one deletion, the slot is consumed before the first key, and every
  failure is reported as possibly incomplete rather than retried.
- **Panel focus and reinsertion.** Making the panel editable means it can
  become the frontmost window. Reinsertion first hides the panel and then
  re-probes; it reuses the undo identity check, so a different field in the same
  app degrades to copy.
