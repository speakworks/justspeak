## Why

PR #30 moved the ASR model selector from the window header into the settings
panel, but the authoritative `settings-surface` spec still says the provider row
is read-only and points at a header picker. The shipped renderer also still
tells the user `在窗口顶部的模型下拉中切换。` (`PROVIDER_HEADER_HINT`) while the
selector sits directly below that row. A reader who follows the spec, or a user
who follows the hint, is sent to a control that no longer exists.

Two other consistency gaps surfaced while verifying the handoff list:
`docs/TECH-DECISIONS.md` still states that no application code exists and still
lists Qwen3-ASR as the pending-benchmark default, and `CHANGELOG.md` only records
the scaffold. The refusal of a hotkey capture during a non-idle session is inline
in main and has no automated coverage.

## What Changes

- Rewrite the `settings-surface` provider requirements: the settings panel owns
  the editable provider control; the sidebar footer shows the live provider
  label and navigates to settings instead of opening a picker.
- Replace the provider hint with one that names the control that exists.
- Record the shipped capabilities in `CHANGELOG.md` and correct the stale status
  text and default-ASR row in `docs/TECH-DECISIONS.md`.
- Move the "capture is refused while recording, transcribing, or pasting"
  decision into `src/core` as a pure function and cover it with a unit test.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `settings-surface`: the provider row is editable in the settings panel, the
  header no longer carries a picker, and the sidebar footer reports the live
  provider and opens settings.
- `app-shell`: the page header no longer carries the provider picker on any
  destination.

## Impact

- `src/core/preferences/view.ts`: provider hint text and the row detail that
  carries it.
- `openspec/specs/settings-surface/spec.md`: provider requirements and scenarios.
- `openspec/specs/app-shell/spec.md`: the header's provider-picker clause.
- `src/core/hotkey/`: new pure hotkey-change guard shared by the capture and
  apply paths.
- `src/main/index.ts`: both binding-change paths delegate to the guard.
- `tests/`: settings view assertions and a new hotkey-change-guard test.
- `docs/TECH-DECISIONS.md`, `CHANGELOG.md`: status and release notes.
