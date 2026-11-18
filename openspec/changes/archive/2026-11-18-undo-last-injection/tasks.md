# undo-last-injection Tasks

## 1. OpenSpec

- [x] 1.1 `proposal.md` records the correction path, risk framing, and non-goals
- [x] 1.2 `specs/injection-undo/spec.md` defines the slot, guard, refusal,
      re-say, panel editing, and window
- [x] 1.3 Deltas for `settings-surface`, `app-shell`, `history`, and
      `menubar-residency`
- [x] 1.4 `design.md` records the probe extension, one-guard decision, and panel
      focus decision

## 2. Focus probe and pure logic (src/core)

- [x] 2.1 `src/core/focus/editability.ts`: `FocusTarget`,
      `parseFocusProbeTarget`, keeping `parseFocusProbeLine` unchanged
- [x] 2.2 `src/core/injection/undo.ts`: `InjectionRecord`,
      `graphemeLength`, `buildInjectionRecord`, `evaluateUndoGuard`,
      `isReSayCandidate`
- [x] 2.3 `src/core/shell/delivery.ts`: `deliverTranscriptDetailed` returning
      the probed focus, while `deliverTranscript` keeps its return type
- [x] 2.4 `src/core/preferences/merge.ts`: `undoWindowMinutes` stored shape,
      writable key, 1–60 integer validation, default 5
- [x] 2.5 `src/core/preferences/view.ts`: describe the window row
- [x] 2.6 `src/core/history/index.ts`: replace one entry's text in place

## 3. Main wiring

- [x] 3.1 `src/main/focus-probe.ts`: five-field probe, bundle id and identity,
      fall back to `unknown`
- [x] 3.2 `src/main/injection.ts`: `deleteCharacters(count)` through System
      Events, no unconditional path
- [x] 3.3 `src/main/index.ts`: single slot, guarded undo, re-say candidate at
      start, refusal panel, menu refresh, history entry association
- [x] 3.4 `src/main/history-store.ts`: `updateText(id, text)`
- [x] 3.5 `src/main/result-panel.ts`: editable payload fields, retained entry
      id and target, reinsert context, hide/re-show helpers
- [x] 3.6 `src/main/tray.ts`: undo item and handler

## 4. Shared types, preload, renderer

- [x] 4.1 `src/shared/ipc.ts`: `UndoStateView`, `UndoResult`, `ReinsertResult`,
      panel payload fields, preferences fields, API methods
- [x] 4.2 `src/preload/index.ts`: undo state, undo, reinsert, change events
- [x] 4.3 `ResultPanel.tsx`: controlled textarea, 重新插入, 撤销, notice, title
- [x] 4.4 `HistoryPane.tsx`: matching-row undo action and refusal feedback
- [x] 4.5 `App.tsx` + `SettingsPanel.tsx`: 撤销时间窗 row

## 5. Tests

- [x] 5.1 Unit: guard refuses on app mismatch, focus mismatch, unknown probe,
      expiry, non-paste method, and no record
- [x] 5.2 Unit: grapheme length for CJK, emoji, combining marks, surrogate pairs
- [x] 5.3 Unit: re-say candidate and replacement decision reuse the guard
- [x] 5.4 Unit: probe parsing for the new format and the legacy format
- [x] 5.5 Unit: history in-place edit and store rewrite
- [x] 5.6 Unit: preferences accept 1–60, reject 0/61/fraction, default 5, view row
- [x] 5.7 E2E: insert → undo restores the text character by character (fake provider)
- [x] 5.8 E2E: re-say guard refusal inserts only the new text, shows 旧文本未删除,
      and puts the old text in the panel
- [x] 5.9 E2E: edit-and-reinsert path and the focus-invalid copy fallback

## 6. Verification

- [x] 6.1 `pnpm exec vitest run` (835 passed / 4 skipped baseline, only grow)
- [x] 6.2 `pnpm typecheck`
- [x] 6.3 `pnpm build`
- [x] 6.4 `openspec validate --specs --strict` and
      `openspec validate undo-last-injection --strict`
- [x] 6.5 Attempt `pnpm e2e`; report honestly if no GUI session

## 7. Delivery

- [x] 7.1 `openspec archive undo-last-injection` (same PR)
- [x] 7.2 Commit, push `feat/undo-last-injection`, open a PR against `main`
      (no merge)
