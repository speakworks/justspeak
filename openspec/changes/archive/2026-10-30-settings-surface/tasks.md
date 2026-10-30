## 1. Preferences surface

- [x] 1.1 Add pure `mergePreferences` (unknown existing keys preserved, only theme/hotkey writable, invalid values reject atomically) and route `ThemeStore.save`, `saveHotkey`, and `update` through it.
- [x] 1.2 Replace `theme:set` and `hotkey:set` with `preferences:get` / `preferences:set`; return one `PreferencesView` and drop the `theme` broadcast.
- [x] 1.3 Add `VocabularyStore.loadDetailed` reporting `default` / `loaded` / `unreadable` with a reason, and put the path and counts on the preferences surface.

## 2. Panel state model

- [x] 2.1 Add pure state selection for theme, hotkey, vocabulary, and provider (`default` / `override` / `unavailable` with a reason) plus `validateHotkeyDraft`.
- [x] 2.2 Report the provider row read-only with the second-provider reason; do not add provider selection.

## 3. Renderer

- [x] 3.1 Add a `SettingsPanel` reachable from the header, move the theme control and hotkey editor into it, and keep a compact appearance indicator in the header.
- [x] 3.2 Show inline errors for an invalid hotkey and an unreadable vocabulary file; add a vocabulary reload action.
- [x] 3.3 Replace the dictation cards while the panel is open and bound the panel height so `document.documentElement.scrollHeight` never exceeds `window.innerHeight` at 720×640 in both themes.

## 4. Tests

- [x] 4.1 Cover merge rules: unknown keys preserved, unknown patch keys rejected, invalid theme/hotkey rejected, atomic rejection, canonicalization.
- [x] 4.2 Cover panel state selection and hotkey draft validation; cover vocabulary `default` / `loaded` / `unreadable` load states.

## 5. Verification and delivery

- [x] 5.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `openspec validate --specs --strict`.
- [x] 5.2 Measure the real 720×640 window with the panel open in light and dark; record `documentElement.scrollHeight` and `innerHeight`.
- [x] 5.3 Archive the change, commit, push, and open a PR against `main` without merging.
