## Context

`App.tsx` (435 lines) already owns everything the shell must keep: the capture
controller, session/IPC subscriptions, theme resolution, provider selection,
preferences and hotkey editing. What changes is only its render tree and where
the vocabulary editor lives.

## Considered solutions

| # | Approach | Pros | Cons | Verdict |
|---|----------|------|------|---------|
| A | Keep one `App.tsx` as the state owner; extract the *views* into components (`Sidebar`, `HomePane`, `DictionaryPane`, `HistoryPane`, `SettingsPane`) and switch on a `view` state | No new dependency; state and effects untouched; each view is a small file | A little prop plumbing | **Chosen** |
| B | Add a router (react-router or similar) | Deep links, back/forward | A dependency and a URL layer for four in-window views with no URLs | Rejected |
| C | One window per destination | Isolation | Four windows, four lifecycles, focus problems | Rejected |

## The delivery contract (the hole the first review found)

Today main always pastes into the frontmost app. A focused home input would then
receive the text twice — once from the synthesized ⌘V, once from the renderer's
caret insert — and an unfocused input would receive a copy the user never asked
for.

Main therefore decides the target, because it is the only side that knows
whether its own window has focus:

```
transcript ready
  if mainWindow.isFocused()  -> send to the renderer, synthesize no keystroke
  else                       -> paste into the frontmost app (unchanged)
```

The seam is the `paste` dependency `App` injects into `SessionController`
(`src/main/index.ts:271`), which the controller calls unconditionally after
emitting the transcript. A flag on the transcript event cannot suppress that
call, so the decision is made **inside the injected dependency**:

```ts
paste: async (text) => {
  if (mainWindow?.isFocused()) {           // our window owns the caret
    mainWindow.webContents.send('transcript:insert', text)
    return                                  // no keystroke, no clipboard touch
  }
  await pasteText(text)                     // unchanged path
}
```

`TranscriptEvent` keeps its shape; the renderer inserts only on
`transcript:insert`. The clipboard snapshot/restore in `pasteTranscript` is never
entered on the focused path, so nothing is written to or restored from the
clipboard.

## Decisions

- **Caret insert, state above the destination switch.** The input's value and
  its last selection live in `App`, not in `HomePane`, so a transcript that lands
  while 词典 or 历史记录 is shown is still inserted and the text survives the
  pane unmounting. Insertion is a functional update over the stored value plus
  the stored selection. A transcript that arrives while an IME composition is in
  progress is **buffered and applied on `compositionend`** — deferred, never
  dropped. After every insert, an effect restores `selectionStart`/`selectionEnd`
  to the end of the inserted text on the live DOM node, so a remount after a
  destination switch puts the caret back where the text ended.
- **A quiet footer, not a status banner.** The input's border carries the session
  state, and the card's footer repeats it once as a dot plus its label (就绪 /
  录音中 / 识别中 / 粘贴中 / 出错了) next to the live hotkey. Errors are rendered
  inside the same card, below the input, because removing the transcript card
  must not remove the only surface that can explain a failed paste or a missing
  model. There is no separate status element outside the card.
- **The header names the destination.** The page header shows the destination's
  title and one line of context (the home line carries the live hotkey). The
  provider picker stays in the header on every destination except settings, where
  the model is a read-only row; the appearance read-out is gone, because the
  appearance is a setting and settings is one click away in the sidebar.
- **The level subscription is dropped.** The renderer no longer draws a level
  bar, so keeping `setLevel` would re-render the tree ~20 times a second for state
  nothing renders. The global pill gets its level from main.
- **Vocabulary moves out of settings.** 词典 renders the existing vocabulary row;
  the gear keeps appearance, hotkey and model. `SettingsPanel` gains a `section`
  prop so the same component serves both, rather than duplicating the editors.
- **History destination is a shell only.** It renders its empty state and a
  heading; the list, storage and retention are the next card. It is explicitly
  not presented as finished.
- **State survives switching.** The capture controller and all subscriptions stay
  in `App`, which is never unmounted, so a destination switch cannot interrupt a
  recording or lose the input.

## Risks

| Risk | Mitigation |
|---|---|
| Extracting views breaks the existing settings behaviours (hotkey validation, theme) | The panes receive the same props `SettingsPanel` already took; the existing tests and a real-app pass cover them |
| The input steals focus in a way that breaks the global hotkey flow | The input is a normal element inside the window; the hotkey path never focuses the window |
| Sidebar implies history works before it does | The destination states plainly that it is empty |

## Revision — 2026-10-31: visual system and the pill's focus side effect

The owner reviewed the first build and asked for a real visual system rather than
a reskin. The layout chosen is the one reviewed as "B · 卡片工作台"; the palette
is "graphite + pine" (macOS semantic surfaces, one brand accent).

- **Design tokens, not ad-hoc colours.** Three planes (canvas / sidebar / card)
  are separated by lightness; the accent covers the mark, the current destination
  and the focus ring only; amber means working and red means recording or
  failure. Components read semantic tokens (`--canvas`, `--surface`, `--text`,
  `--muted`, `--faint`, `--line`, `--accent`, `--amber`, `--red`), so a palette
  change never touches a component rule.
- **The window is draggable again.** With `titleBarStyle: 'hiddenInset'` and no
  drag region, the window could not be moved at all. The sidebar and the page
  header are drag regions; every interactive element opts out.
- **The overlay was deactivating the app.** `setVisibleOnAllWorkspaces` swaps the
  process type between ForegroundApplication and UIElementApplication by default,
  and that swap deactivated the app roughly 30 ms after the pill appeared. The
  delivery decision then read `isFocused() === false` and pasted instead of
  inserting, even while the user was dictating into JustSpeak. Fixed with
  `skipTransformProcessType: true`; the collection behaviour that puts the pill
  on every Space is unchanged. **Manual check owed:** the pill still shows above
  a fullscreen app and on a second Space with this flag.
- **Delivery routing is unit-tested.** `deliverTranscript` takes the focus state
  and both sinks as ports, so "insert once, never paste" and the inverse are
  deterministic tests; the E2E covers the renderer half (text arriving on
  `transcript:insert` lands once, no keystroke, clipboard untouched). A test that
  depended on real OS focus was removed — on an active machine macOS never hands
  focus to the test window, which made it fail for environmental reasons.
