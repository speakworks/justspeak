## 1. Pure history rules (test-first)

- [x] 1.1 Failing tests for parse/serialize: one line per entry, newlines inside text, corrupt lines skipped
- [x] 1.2 Failing tests for grouping: local date keys, 今天 / 昨天 / date labels, newest-first ordering
- [x] 1.3 Failing tests for retention: 1000-entry and 30-day windows, audio cap strips only audio, empty input
- [x] 1.4 Implement `src/core/history/index.ts`

## 2. Store

- [x] 2.1 Append/list/remove over `userData/history/entries.jsonl`, serialised by one queue
- [x] 2.2 Write the recording as `audio/<id>.wav`; a failed audio write keeps the text row
- [x] 2.3 Remove deletes audio before the row; sweep deletes audio before rewriting
- [x] 2.4 Startup sweep enforces retention and removes orphan WAVs
- [x] 2.5 Tests: missing file, concurrent appends, WAV round trip, remove, age sweep, orphan cleanup

## 3. Recording the settlement

- [x] 3.1 `SessionController` reports `{ ok, target }` after delivery; a failed paste still reports
- [x] 3.2 Main keeps the capture until the settlement and appends it with the entry
- [x] 3.3 History write failures are warnings, never a session error

## 4. IPC and renderer

- [x] 4.1 `history:list`, `history:delete`, `history:audio`, `clipboard:write-text` gated by the main-window sender check
- [x] 4.2 Preload + shared types
- [x] 4.3 History pane: date groups, outcome badge, duration, play/stop, copy, delete, empty and error states

## 5. Verification

- [x] 5.1 `pnpm typecheck`, `pnpm test` (566 passed / 4 skipped), `pnpm build`
- [x] 5.2 Playwright probe (temporary `userData`): paste outcome recorded end-to-end, restart keeps rows, copy matches clipboard, delete removes the row — committed as `tests/e2e/history.spec.ts`; the insert→`inserted` mapping is pinned by `tests/session-controller.test.ts`, because a headless GUI session cannot establish real window focus
- [x] 5.3 One-off local Playwright probe with real SenseVoice and a WAV microphone: entry carries RIFF 16 kHz mono audio, playback reaches `停止`, restart keeps the audio, delete removes the WAV (requires the local model, so it is not in the default suite)
- [x] 5.4 Owner acceptance on the development build, 2026-11-01 (the packaged build still lacks the ASR runtime, see PRODUCT-FEEDBACK item 11)
