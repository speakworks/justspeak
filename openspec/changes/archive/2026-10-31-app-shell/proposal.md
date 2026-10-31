## Why

The main window is a demo of the pipeline, not a place to dictate: a record
button, a status chip, a transcript card, a model line, and settings behind a
toggle. The owner asked for an app whose main surface is **an input box you can
dictate into** — the same interaction as typing, with the pipeline invisible.

Competitor layout (read from the installed Typeless app) puts a persistent
sidebar of destinations on the left and the working surface on the right. That
is the shape the follow-up history card needs, so the shell is built first.

## What Changes

- The window becomes a sidebar + content layout: **首页 / 历史记录 / 词典**, with
  a gear at the bottom of the sidebar opening the existing settings surface
  (appearance, hotkey, model).
- **首页** is one editable input. Dictated text is inserted at the caret; there is
  no record button, no transcript card, and no status text.
- Recording state is shown by the input's own border and by the existing global
  pill, not by new controls.
- 词典 is the existing vocabulary editor, moved out of the settings panel.
- **Delivery becomes focus-aware:** when the app's own window has focus the
  transcript is delivered to the renderer and inserted into the input with no
  synthesized keystroke; otherwise the existing paste into the frontmost app is
  unchanged.
- 历史记录 is a destination that exists and states it is empty; its content is a
  separate card.

## Capabilities

### New Capabilities

- `app-shell`: the sidebar/destination layout and the dictation input.

### Modified Capabilities

- `settings-surface`: theme and hotkey live behind the sidebar gear, the provider
  row only points at the header picker, and the vocabulary editor moves to 词典.
- `dictation-session`: clipboard injection is scoped to the case where the app's
  own window does not have focus.
