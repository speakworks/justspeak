# undo-caret-guard Tasks

## 1. OpenSpec

- [x] 1.1 `proposal.md` records the caret drift, unreadable-value, cap, and
      target-switch behavior and the three frozen decisions
- [x] 1.2 `specs/injection-undo/spec.md` adds the probe, caret, cap, and
      target-switch requirements with explicit failure paths
- [x] 1.3 `openspec validate undo-caret-guard --strict` passes before code

## 2. Focus probe (src/main/focus-probe.ts + core parsing)

- [x] 2.1 Read `AXSelectedTextRange` as `location` and `length`; emit an
      explicit `NONE` sentinel when unreadable
- [x] 2.2 Extend `FocusTarget` with `selection` and parse both the seven-field
      probe and the legacy five-field answer

## 3. Undo span logic (src/core/injection)

- [x] 3.1 `InjectionRecord` records `insertionStart`, `selectionLengthBefore`
      and the inserted grapheme count
- [x] 3.2 `evaluateUndoCaret` approves only a collapsed caret at `P0 + A`;
      refuses a moved caret or an active selection
- [x] 3.3 `MAX_UNDO_CHARS = 500` refuses longer records; unreadable values use
      the conservative count with a logged reason
- [x] 3.4 `evaluateUndoGuard` threads the caret decision and the cap through
      the single guard

## 4. Delete path and main wiring

- [x] 4.1 `buildDeleteArgs` passes the expected caret; the atomic script
      re-reads the selection and aborts before any key on a mismatch
- [x] 4.2 `deleteIfTargetMatches` refuses counts above `MAX_UNDO_CHARS`
- [x] 4.3 Main logs the conservative reason and shows `目标已切走，未回退` when
      the target process or focus is gone

## 5. Tests

- [x] 5.1 Probe parsing: location/length, unreadable sentinel, legacy format
- [x] 5.2 Caret decision: exact match deletes `N`, moved caret and active
      selection refuse, unreadable uses the conservative count
- [x] 5.3 Cap: 500 allowed, 501 refused, constant has no preference path
- [x] 5.4 Guard: caret refusal and cap refusal surface through the single
      decision; target switch keeps the named message

## 6. Verification

- [x] 6.1 `pnpm exec vitest run` (1041 passed / 4 skipped; baseline was
      1024 passed / 4 skipped)
- [x] 6.2 `pnpm typecheck`
- [x] 6.3 `pnpm build`
- [x] 6.4 `openspec validate --specs --strict`

## 7. Delivery

- [x] 7.1 `openspec archive undo-caret-guard --yes`
- [x] 7.2 Commit, push `feat/undo-caret-guard`, open a PR against `main`
