## Context

`docs/PRODUCT-FEEDBACK.md` item 6 deferred diagnostics because neither a
persistent log writer nor an upload/privacy decision existed. The local-only
shape is self-contained: the user chooses where to save a zip and decides
whether to share it. Nothing leaves the machine automatically.

## Decisions

### Local bundle, no upload

The export is a native save dialog plus a zip on disk. The app never uploads,
never opens a network request, and does not add an analytics dependency. A
future upload path would need its own consent and retention design.

### What goes in

- `summary.json`: app/Electron/Chrome/Node versions, platform/arch/locale,
  provider mode and health, permission status, ASR and LLM runtime/model
  presence, preference summary without secrets, history entry count only.
- `logs/justspeak.log` (and rotated files): main-process console output.
- `crash-dumps/`: recent files from `app.getPath('crashDumps')`, capped in age
  and total size.
- `README.txt`: what is included, what is excluded, and how to share it.

### What never goes in

Transcripts, clipboard contents, history text, audio, vocabulary entries, API
keys, and raw endpoint URLs. The bundle is built from explicit fields and a
redaction pass, not by copying userData wholesale.

### Logging and redaction

A `DiagnosticsLog` appends main-process console lines to
`<logs>/justspeak.log`, rotating at ~1 MB with two backups. A tee keeps the
existing terminal output. `redactDiagnosticText` replaces the home directory
and userData path with stable placeholders and masks `Bearer <token>` values.
Endpoint request failures are logged as only the error name and code, never the
configured URL or host. The log is opened with `O_NOFOLLOW`, so a symlink
planted at the predictable path cannot redirect writes into another file.
Logging failures are swallowed: diagnostics must never break dictation.

### Crash dumps

`crashReporter.start({ uploadToServer: false })` runs before app ready. The
export includes at most the 10 newest dump files modified in the last 30 days,
with a 20 MB total cap; missing or unreadable dumps are skipped, not fatal.
The collector uses `lstat` and rejects symlinks and non-regular files, and the
copy step re-checks before copying: the user-writable dump directory must not
be able to pull an arbitrary local file into a bundle the user may share.

### Export mechanics

The main process writes a staging directory under `app.getPath('temp')`, then
zips its contents with `/usr/bin/zip -r -q <target> .` (so the random staging
directory name is not a top-level folder) to a sibling temporary file, and
renames it over the chosen target only after zip succeeds. A failed export must
not delete the user's previous zip. The staging and temporary files are removed
in `finally`. A save-dialog cancel returns `{ ok: false, canceled: true }` and
writes nothing. In development, an optional `JUSTSPEAK_DIAGNOSTICS_EXPORT`
absolute path bypasses the dialog for E2E tests; packaged builds ignore it.

### IPC and UI

`diagnostics:export` is trusted-sender-only. The renderer receives only
`{ ok, canceled?, path?, message? }` and shows the saved path or the error next
to the settings action. The export runs one at a time.

## Risks

- Logs may contain local paths or error text; redaction covers the home and
  userData paths and bearer tokens, not every possible secret. The README tells
  the user to inspect the zip before sharing.
- A crash dump can contain process memory; dumps are included only when the OS
  produced them, and the user explicitly chooses to export.
- Directory-level symlinks, hard links, and the `lstat`→`copyFile` race are
  outside this local, same-user threat model; the file-level checks close the
  static-link path a local process can plant without already owning the user's
  files.
- Long-running sessions rotate logs, so the bundle holds recent history rather
  than everything since first launch.
