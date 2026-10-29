## Context

Theme and hotkey already share `userData/preferences.json` through `ThemeStore`, and the vocabulary lives in a separate `userData/vocabulary.json`. The renderer currently keeps its own theme/hotkey copies fed by `state:get`, a `theme` broadcast, and the return values of `theme:set` / `hotkey:set`. Adding a panel on top of those three paths would create a fourth copy, so the change collapses them first.

## Decisions

### One preferences surface, not convenience channels

`preferences:get` builds a `PreferencesView` from disk, the live accelerator, and a fresh vocabulary read. `preferences:set` accepts only `theme` and `hotkey`, validates, persists, and returns the same view. `theme:set`, `hotkey:set`, and the `theme` event are deleted; the header button and the hotkey row cannot bypass the surface because they no longer exist.

### Merge is pure and atomic

`mergePreferences(existing, patch)` keeps unknown existing keys, rejects unknown patch keys, validates theme and hotkey, and rejects the whole patch if any value is invalid. `ThemeStore.update` applies the pure result over the freshest on-disk record inside the existing write queue, so concurrent saves still cannot drop each other's key.

### Vocabulary is summarized, not duplicated

The panel shows the absolute path, replace and protect counts, and one of `default` (no file), `loaded`, or `unreadable` with the parse error. `getPreferences` re-reads the file and refreshes `postprocessOptions`, so "重新加载" is just a read. The vocabulary keeps its own file; the panel never writes it.

### The panel replaces the cards

The window is deliberately 720×640 and the transcript card has a fixed height to avoid a page scrollbar. The settings view swaps the dictation cards for one panel, keeping the header; the panel has a bounded height and its own scroll only as a smaller-display safety net. The theme control moves into the panel, while the header keeps a compact appearance read-out.

### Provider is read-only until the second provider lands

Provider selection is a separate change (PR #12). This panel reports the live provider id and label, marks the row unavailable, and names the missing support. A disabled `select` is shown so the row is visibly not a working control.

## Risks

- A failed preference write after a successful hotkey registration leaves the live binding ahead of disk. `preferences:set` reports the save failure; registration state is not silently rolled back because re-registering during the same call would be a second OS change.
- Exposing the userData path to the renderer is intentional: there is no remote content in the window and the path is user-facing information.
