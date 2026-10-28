## Why

The toggle accelerator is hardcoded as `CommandOrControl+Shift+Space`. A user whose shortcut collides with another app has no recovery path, and the startup failure message names the binding but leaves the app without a hotkey. ADR-0003 already reserves a `HotkeySource` boundary for registration, so the missing pieces are a validated binding choice, persistence alongside the theme, and a visible fallback when the OS refuses the binding.

## What Changes

- Add a pure accelerator parser in `src/core/hotkey` that accepts Electron accelerator syntax, canonicalizes it, and rejects empty, unparseable, and modifier-less strings. Rejecting modifier-less strings prevents a bare key from being captured system-wide.
- Add a `HotkeySource` interface per ADR-0003 and an `ElectronGlobalShortcutSource` adapter behind an injected `GlobalShortcutPort`, so tests exercise registration without Electron.
- Register the stored binding at startup. When the OS refuses it, register the default `CommandOrControl+Shift+Space` and surface a message that names the refused binding; when both fail, say so explicitly instead of silently leaving no hotkey.
- Persist the accelerator in the existing `userData/preferences.json` through `ThemeStore`, merging writes so the theme and any unknown keys survive. Missing or corrupt files fall back to defaults without throwing.
- Add a compact hotkey row to the existing dictation card: an input with live validation, an apply control, and the currently registered accelerator. The row replaces the static hint line so the measured window height does not grow.
- Refuse rebinding while a dictation is in progress, because re-registration unregisters the live accelerator.

## Capabilities

### New Capabilities

- `hotkey-config`: accelerator validation, the `HotkeySource` boundary, registration fallback, and preference persistence.

### Modified Capabilities

- None.

## Impact

- `src/core/hotkey`: new pure parser, boundary types, and fallback registration logic.
- `src/main`: `ElectronGlobalShortcutSource`, startup registration, `hotkey:set` IPC, and theme-store write merging.
- `src/preload` and `src/shared/ipc`: one narrow `setHotkey` bridge method and hotkey fields on the status payload.
- `src/renderer/src`: compact editor with live validation; no new window height.
- `tests/`: parser accept/reject table, fallback registration with an injected double, and preference round-trip/corruption tests.
