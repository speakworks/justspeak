## 1. Pure accelerator parser

- [x] 1.1 Add `parseAccelerator` with Electron modifier/key aliases, canonical spelling, and typed errors for empty, non-string, unknown, duplicate, multi-key, no-key, and modifier-less input; verify the accept/reject table in `tests/hotkey.test.ts`.
- [x] 1.2 Add `parseHotkeyPreference` and macOS display parts; verify invalid stored values fall back to the default and the default renders as `⌘ ⇧ Space`.

## 2. Hotkey boundary and fallback

- [x] 2.1 Add the ADR-0003 `HotkeySource` types and an `ElectronGlobalShortcutSource` over an injected `GlobalShortcutPort`; verify a port double observes `unregisterAll` and press delivery.
- [x] 2.2 Add `registerHotkeyWithFallback` returning the live accelerator, fallback flag, and a message naming every failed binding; verify requested-only, fallback, both-failed, and same-as-default cases.

## 3. Persistence

- [x] 3.1 Extend `ThemeStore` with `loadPreferences` and `saveHotkey`, merging writes so the theme and unknown keys survive; verify hotkey-after-theme, theme-after-hotkey, unrelated keys, canonicalization, and corrupt/non-object files in `tests/preferences.test.ts`.

## 4. Main process wiring

- [x] 4.1 Register the stored accelerator at startup through the boundary, expose the active accelerator and fallback notice in `state:get`, and stop registration on quit.
- [x] 4.2 Add `hotkey:set` with the trusted-sender check, parser validation, rebind refusal during an active session, fallback registration, and persistence only on success.

## 5. Renderer

- [x] 5.1 Add a single-row hotkey editor with live validation, an apply action, the currently registered accelerator, and fallback/error feedback using existing CSS variables; verify the row replaces the static hint without growing the header.

## 6. Verification and delivery

- [x] 6.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `openspec validate --specs --strict`; commit, push, and open a PR against `main` without merging.
