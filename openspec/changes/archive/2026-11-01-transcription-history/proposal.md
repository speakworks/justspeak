## Why

The sidebar has a 历史记录 destination, but it was a fixed placeholder: the pane
always said "还没有记录", main's `transcript` event had no consumer, and nothing
was written to disk. A user who dictated successfully therefore found an empty
history and could reasonably read it as data loss (owner report, 2026-11-01).

## What Changes

- Every finished transcript is appended to a local history file with its text,
  timestamp, duration, latency and the outcome of the delivery step
  (`inserted`, `pasted`, `paste_failed`).
- The recording itself is saved beside the entry as 16 kHz mono PCM16 WAV and can
  be played back from the history pane.
- 历史记录 groups rows by local calendar day (今天 / 昨天 / date), newest first,
  and offers copy and delete per row.
- Retention follows the plan card's frozen decisions: text keeps the newest 1000
  entries or 30 days, whichever binds first; audio is kept for the newest 500
  entries, after which only the audio file is removed. Cleanup deletes audio
  before rewriting rows and also removes orphan WAVs left by an interrupted run.
- History is local-only and lives under `userData/history/`. A failed history
  write never changes the dictation outcome.

## Capabilities

### New Capabilities

- `history`: local transcript history, audio retention, and the 历史记录 pane.

### Modified Capabilities

None.

## Impact

- `src/core/history` (pure parsing, grouping, retention), `src/main/history-store`
  (file access), `src/main/index.ts` (recording the settlement, IPC),
  `src/preload`, `src/shared/ipc`, `src/core/session/session-controller.ts`
  (settlement callback) and `src/renderer/src/HistoryPane.tsx`.
- Data lives in `userData/history/entries.jsonl` and `userData/history/audio/`.
  Nothing is written into the repository.
