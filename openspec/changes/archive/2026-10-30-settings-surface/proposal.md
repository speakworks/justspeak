## Why

Preferences arrived one card at a time: the theme lives behind a header cycling button, the hotkey editor sits inside the dictation card, the vocabulary file is loaded silently at startup, and the ASR provider cannot be chosen at all. The renderer therefore has several places that can disagree with disk, and a corrupt vocabulary file has no visible symptom. One settings panel over one preferences surface gives every preference the same read/write path and one honest place to say "default", "overridden", or "unavailable".

## What Changes

- Add a single `preferences:get` / `preferences:set` IPC surface for theme, hotkey, and the vocabulary summary. `theme:set`, `hotkey:set`, and the `theme` broadcast channel are removed so there is no second writer.
- Keep `userData/preferences.json` as the only theme/hotkey store and keep merge-on-write. Move the merge rules into a pure `mergePreferences` function: unknown existing keys survive, only `theme` and `hotkey` are writable, and an invalid value rejects the whole patch without writing.
- Report the vocabulary file (path, entry counts, `default` / `loaded` / `unreadable`) on the same surface. A file that exists but cannot be parsed is reported with its reason instead of being silently ignored; a reload re-reads it and updates the post-processing stage.
- Replace the header theme button with a compact appearance indicator plus a "设置" toggle; move the three-state theme control and the hotkey editor into a panel that replaces the dictation cards while open, so the fixed window height never grows.
- Label every row as default, overridden, or unavailable. The provider row is read-only and states that choosing a model needs the second-provider work to land first; no provider-selection path is invented here.

## Capabilities

### New Capabilities

- `settings-surface`: one preferences IPC surface, the settings panel, honest per-setting states, inline validation, the no-scroll constraint, and the read-only provider row.

### Modified Capabilities

- None.

## Impact

- `src/shared/ipc`: `PreferencesView`, `PreferencesPatch`, `PreferencesSetResult`, `VocabularySummary`, `ProviderSummary`; `JustSpeakApi` gains `getPreferences` / `setPreferences` / `onPreferencesChanged`.
- `src/core/preferences`: pure merge rules and pure panel state selection.
- `src/main`: one `preferences:get` / `preferences:set` handler, vocabulary detail reporting, provider summary, and removal of `theme:set` / `hotkey:set`.
- `src/preload`: the three preferences bridge methods.
- `src/renderer/src`: `SettingsPanel` and a settings view in `App`; the dictation card loses the hotkey row.
- `tests/`: merge rules, panel state labels, hotkey draft validation, and vocabulary load states.
