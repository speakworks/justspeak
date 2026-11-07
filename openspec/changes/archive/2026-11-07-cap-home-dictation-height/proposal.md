## Why

At the fixed 720×640 window the 首页 sheet is `flex: 1`, so it fills every pixel
between the page header and the bottom padding — roughly 500 px of card around a
three-line input. The owner reviewed the running app as "口述内容区域太大了": the
empty space reads as unused capacity, and the sheet draws the eye away from the
text it is supposed to hold.

The sheet's height does not need to track its content: the input already scrolls,
so a fixed height reads the same for a short note and a long transcript. The
answer is a fixed 300 px card, top-aligned, with the rest of the pane left empty.

## What Changes

- Fix the 首页 sheet at 300 px and top-align it inside the pane. A long transcript
  scrolls inside the input rather than growing the card.
- Everything else on the destination stays as it is: one editable input, the
  state footer, the empty-state hint, and no pane scrollbar.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `app-shell`: the 首页 working surface has a fixed height instead of filling the
  pane.

## Impact

- `src/renderer/src/styles.css`: a new `.sheet-dictation` height rule; the shared
  `.sheet` rule is left untouched because 历史记录 reuses it.
- `openspec/specs/app-shell/spec.md`: the 首页 surface requirement.
