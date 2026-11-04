## Why

A failure currently reaches the user as one status line and reaches the
maintainer nowhere. There is no persistent main-process log, no crash-dump
collection, and no bundle a user can attach to a report. Product feedback item 6
recorded two feasible shapes; this change implements the local-only one because
it needs no vendor account, no upload endpoint, and no new privacy decision.

## What Changes

- Persist main-process logs under the app's logs directory with size rotation.
- Add a user-initiated **导出诊断** action that writes a local zip containing:
  app/runtime summary, recent main-process logs, recent crash dumps, and a
  README describing the contents.
- Redact home/userData paths and bearer tokens from log text.
- Exclude transcripts, audio, history text, vocabulary entries, API keys, and
  raw endpoint URLs from the bundle.
- Never upload automatically and never contact the network for diagnostics.
- Show the saved path or the failure in the settings surface; cancel is a no-op.

## Impact

- Affected specs: `diagnostics-export` (new).
- Affected code: `src/main` (logger, export, IPC), `src/preload`,
  `src/renderer` (settings action), `src/core/diagnostics` (pure redaction and
  summary builders), tests.
- No change to dictation, history storage, or delivery behavior.
