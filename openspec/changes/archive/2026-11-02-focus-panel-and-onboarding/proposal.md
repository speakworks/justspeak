## Why

Two gaps surfaced after the first real-device trial:

- Delivery pasted whenever JustSpeak's own window was not focused. If the
  frontmost element could not accept text (Finder's desktop, a Chrome page
  surface, a window with no input), the keystroke went nowhere or into the wrong
  place, and the user only saw an error after the fact.
- A fresh install opened to an empty window with no hotkey, no explanation of
  where text goes, and no guidance for the Accessibility permission the paste
  path needs.

A real-device probe confirmed macOS Accessibility can answer the first question:
TextEdit/CotEditor/VS Code expose `AXTextArea`, a focused Chrome input exposes
`AXTextField`, while Finder's desktop is `AXGroup`/`AXOutline` and a Chrome page
surface is `AXWebArea`. When the probe cannot answer, the safe choice is a copy
panel, never a silent paste.

## What Changes

- Delivery becomes focus-aware: own window → insert; editable frontmost element →
  paste; non-editable or unknown → a persistent copy panel at the recording
  pill's position, with the text and a copy action. The panel never takes focus
  and dismisses on copy, close, or Escape.
- History gains the `panel` outcome for transcripts that reached the panel.
- A one-screen first-run guide explains the hotkey, where text goes, and the two
  permissions. It reads Accessibility and microphone status without prompting,
  deep-links to the Accessibility pane, re-checks when the window regains focus,
  and stays dismissed per userData.

## Capabilities

### New Capabilities

- `onboarding`: the first-run guide and permission status surface.

### Modified Capabilities

- `dictation-session`: delivery chooses between insert, paste, and the copy panel
  from focus plus Accessibility editability.
- `history`: records the `panel` outcome.

## Impact

- `src/core/focus`, `src/core/onboarding`, `src/core/shell/delivery.ts`,
  `src/main/focus-probe.ts`, `src/main/result-panel.ts`,
  `src/main/index.ts`, `src/preload`, `src/shared/ipc`,
  `src/renderer/src/ResultPanel.tsx`, `src/renderer/src/Onboarding.tsx`.
- No new permission: the probe uses the same System Events path as paste.
- The panel and first-run screen each have their own renderer entry (`?panel=1`,
  and the main `App`), so neither starts a second capture controller.
