## Why

The settings surface asks the user to type an Electron accelerator string such
as `CommandOrControl+Shift+Space`. That is a developer-facing format: it needs
knowledge of modifier aliases, the `+` separator, and key names, and it is easy
to typo without noticing. Every macOS shortcut editor lets the user press the
chord instead. The app already has a pure accelerator parser, so the missing
pieces are a key-event mapper and a way to stop the live binding from swallowing
the chord being recorded.

## What Changes

- Add a pure `captureHotkey` mapper in `src/core/hotkey` that turns a
  `KeyboardEvent`-shaped input into an accelerator, using the physical `code`
  (layout independent), reporting modifier-only chords as pending, treating bare
  Escape as cancel, refusing modifier-less chords, and refusing macOS-reserved
  combinations such as Command+Q and Command+Tab.
- Replace the settings text input with a press-to-record control. Clicking it
  arms recording; the next chord is canonicalized and applied through the
  existing `preferences:set` path. Modifiers appear as glyphs while the chord is
  unfinished; Escape or blur cancels.
- Add `hotkey:capture-start` / `hotkey:capture-end` in main. Starting a capture
  temporarily unregisters the dictation accelerator (otherwise the app's own
  global shortcut swallows the chord, including the current binding), suppresses
  native menu accelerators so Command+Q/Command+R reach the recorder instead of
  quitting or reloading, and arms a 15 s safety restore. Applying a new binding
  ends the capture directly. The lifecycle lives in a pure
  `HotkeyCaptureController` with an injected source and clock so stop, restore,
  timeout, and no-restore-on-apply are unit-tested.
- Push `hotkey:capture-ended` when main restores on its own, so an abandoned or
  crashed renderer cannot leave the recorder stuck or the dictation key dead.
- Remove the now-unused typed-draft validator from the preferences view; the
  parser remains the single validator for the captured chord.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `hotkey-config`: the renderer records a chord instead of accepting typed
  accelerator syntax; capture temporarily suspends the live binding and restores
  it safely.
- `settings-surface`: inline hotkey validation now describes the recorder —
  an invalid chord keeps the recorder armed and writes nothing, rather than
  disabling a typed field's apply action.

## Impact

- `src/core/hotkey`: new pure capture mapper, modifier display helper, and
  capture lifecycle controller.
- `src/main`: capture lifecycle, safety timeout, and two trusted IPC handlers.
- `src/preload` / `src/shared/ipc`: capture start/end bridge plus the
  `hotkey:capture-ended` push.
- `src/renderer/src`: `HotkeyRecorder` component replaces the text input and the
  apply button; the settings panel keeps one message surface.
- `tests/`: capture mapping table; existing parser, registration, and
  preference tests unchanged.
