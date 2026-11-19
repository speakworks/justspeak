## Why

The correction path is the only feature that presses Backspace **inside another
application**. `src/core/injection/undo.ts` says it outright: a wrong Backspace
deletes text in someone else's window. The whole guard exists to make that
impossible, yet the only end-to-end evidence today is a fake `osascript` shim
(`tests/e2e/undo.spec.ts`), which proves the TypeScript decision logic and
nothing about macOS.

Concretely, these paths have never run against the real system:

- the real `DELETE_SCRIPT` AppleScript in `src/main/injection.ts`
  (`deleteIfTargetMatches`) — the shim replaces the interpreter, so the script
  text itself is never executed;
- `activateRunningApp` (`src/main/injection.ts`) — `grep tests/` finds no
  reference at all;
- `Command+'` as a real system hotkey — `globalShortcut` accepting the key is
  unverified (`docs/AI-HANDOFF.md`, P1 item 5);
- `Cmd+Q` / `Cmd+R` during recording being suppressed by the app menu rather
  than quitting or reloading — the current E2E sends Playwright synthetic
  events, which never reach the native menu.

Two further facts make this urgent rather than tidy-up work:

1. The undo suite is intermittently red on a full local run (three different
   tests failed across four runs, always in the lock/timing family). A
   safety-critical suite that flakes cannot serve as a gate.
2. `docs/REAL-MACHINE-CHECKS.md` records that the present runs are **blocked**,
   so the gap is now written down instead of assumed closed.

## What Changes

- **Opt-in real-machine harness.** Two Playwright specs that only run when
  asked for: `tests/e2e/undo-real-ax.spec.ts` (`JUSTSPEAK_REAL_AX=1`) and
  `tests/e2e/hotkey-real-keys.spec.ts` (`JUSTSPEAK_REAL_KEYS=1`). With the
  environment variable unset the whole file skips, so `pnpm test`, `pnpm e2e`
  and CI keep their current cost and behaviour.
- **The AX harness drives TextEdit, not a shim.** A temporary document is
  opened, the transcript is inserted, and undo must remove exactly the recorded
  grapheme count. The three cases are: exact reduction; a foreground switch
  before undo must send no key; a quit target must be refused and its text
  preserved in the result panel.
- **The keyboard harness sends real key events.** `Command+'` must start
  recording through the system, and `Cmd+Q` during recording must not quit —
  run against a dedicated instance, never against a JustSpeak the user is
  using.
- **`docs/REAL-MACHINE-CHECKS.md`** records the machine, the macOS version, the
  date and a per-item pass/fail/blocked table. Skipped is never recorded as
  passed; a missing Accessibility or Automation grant makes the spec fail and
  print the reason instead of skipping quietly.
- **Known limits stay visible.** Whatever the real runs show — including
  apps that do not expose a usable identity — is written into the check list
  rather than smoothed over.

The specs are written and reviewed in this change, but they are **pending
execution**: the machine that produced this change had no runnable GUI session
(see `docs/REAL-MACHINE-CHECKS.md`). Nothing in this change may claim a real
run passed.

## Goals

- A future contributor can answer "does the delete path work on real macOS?"
  with one command and a pass/fail table, instead of reading TypeScript.
- The default test suite stays fast, offline, and GUI-free.
- The failure mode of the real harness is a failing test with a printed reason,
  never a silent skip.

## Non-Goals

- No change to `src/`. If the real run finds a defect, it gets its own change.
- No CI wiring: the repository deliberately keeps Electron E2E out of CI
  (`.github/workflows/ci.yml`), and that decision is not revisited here.
- No Windows/Linux matrix, no signing, no release work.
- No claim that the documented assumptions (caret at end of inserted text,
  skipped bundle check when the bundle id is empty) are now verified; the real
  runs are what can retire them.
