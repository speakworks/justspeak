## 1. Delivery contract (test-first)

- [x] 1.1 Failing test: the injected paste dependency skips the paste when the app's own main window is focused and asks the renderer to insert instead
- [x] 1.2 Implement the focus-gated paste dependency in `src/main/index.ts` and the `transcript:insert` channel (preload + shared ipc)
- [x] 1.3 Test: when unfocused, the transcript is pasted and no insert message is sent
- [x] 1.4 `deliverTranscript` in `src/core/shell/delivery.ts` takes focus and both sinks as ports; unit tests pin "insert once, never paste" and the inverse

## 2. Input rules (pure, test-first)

- [x] 2.1 Failing test for `insertAtSelection(value, start, end, text)` — insert at caret, replace selection, caret after inserted text
- [x] 2.2 Implement it in `src/core/shell/insert.ts`

## 3. Shell layout

- [x] 3.1 `Sidebar` component: 首页 / 历史记录 / 词典, current marker, settings entry and the running model at the bottom
- [x] 3.2 Home pane: one textarea, its card carries the state, the empty hint and the error line
- [x] 3.3 `HistoryPane` (explicit empty state); 词典 renders the vocabulary editor
- [x] 3.4 `SettingsPanel` gains a `section` prop; the page header owns the title and the way back
- [x] 3.5 `App` owns destination, input value and caret; transcript insert is buffered during IME composition and flushed on `compositionend`; the level subscription is removed
- [x] 3.6 Design tokens (canvas / sidebar / surface / text / muted / faint / line / accent / amber / red) and the "graphite + pine" palette; light and dark resolve from one token set
- [x] 3.7 The window is draggable again: sidebar and page header are drag regions, interactive elements opt out
- [x] 3.8 Empty composer hint replaces the placeholder text so the input can stay borderless

## 4. Verification

- [x] 4.1 `pnpm typecheck`, `pnpm test`, `pnpm build`, `openspec validate --strict`, `pnpm e2e`
- [x] 4.2 Screenshot every destination in light and dark; the header, sidebar and card hierarchy survive both themes
- [x] 4.3 The overlay no longer deactivates the app: `skipTransformProcessType` on `setVisibleOnAllWorkspaces`, which was making the focused path paste instead of insert
- [x] 4.4 Real app: destination switch keeps the recording and the input text (owner-verified 2026-10-31)
- [x] 4.5 Real app: dictating with the window focused inserts once (no duplicate) and leaves the clipboard untouched; dictating from another app still pastes (owner-verified 2026-10-31)
- [x] 4.6 Real app: the pill still shows above a fullscreen app and on a second Space with `skipTransformProcessType` (owner-verified 2026-10-31)
