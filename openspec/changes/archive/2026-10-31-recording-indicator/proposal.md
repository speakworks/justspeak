## Why

Dictation into another application gives no feedback. The app owns exactly one
plain window; the global hotkey's handler only calls `toggleRecording()` and
never surfaces it, and there is no menu-bar item, so while the user speaks into
an editor the only evidence that recording started is the text appearing later.
Measured on the installed build: `document.hasFocus()` is false while dictating,
and the window is behind whatever the user is working in.

Competitor implementations all solve this with a non-activating overlay panel:
Handy builds a macOS NSPanel (`PanelLevel::Status`, `no_activate`,
`nonactivating_panel`, `can_join_all_spaces`, `full_screen_auxiliary`), VoiceInk
uses an `NSPanel` with `.nonactivatingPanel` and `orderFrontRegardless()`. Both
anchor it to the screen's work area and show a distinct working state after the
recording ends.

A probe on this machine verified that Electron can do the same: a
`type: 'panel'`, `focusable: false`, `alwaysOnTop: 'status'` window is visible,
does not change the frontmost application, and still receives mouse clicks
(13 clicks recorded while `document.hasFocus()` stayed false).

## What Changes

- A second, non-activating window shows a compact pill at the bottom centre of
  the display under the cursor: ✕ (cancel), a live waveform, ✓ (finish). No text.
- The pill appears when capture starts, switches to a working form while
  transcribing/pasting, and disappears after the paste completes.
- The waveform is driven by the real audio level, computed in main from the
  existing `capture:pcm` batches and throttled to ~30 updates/second.
- Cancelling is a new session transition: recording → idle, discarding the
  captured audio without transcribing, pasting, or touching the clipboard.

## Capabilities

### New Capabilities

- `recording-indicator`: the system-level, non-focus-stealing recording pill.

### Modified Capabilities

- `dictation-session`: adds cancellation as an explicit transition out of
  `recording` that discards the capture.
