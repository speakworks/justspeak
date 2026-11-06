## 1. Provider surface

- [x] 1.1 Replace `PROVIDER_HEADER_HINT` with a hint that names the settings selector instead of the removed header picker, and update the settings-view assertion.
- [x] 1.2 Confirm the archived `settings-surface` delta matches the shipped panel: editable selector in settings, sidebar chip navigates, no picker in the header.
- [x] 1.3 Drop the `app-shell` clause that required the page header to carry the provider picker.

## 2. Capture guard

- [x] 2.1 Add a pure `hotkeyChangeRefusal(state)` in `src/core/hotkey` that returns the refusal message for a non-idle session.
- [x] 2.2 Use it in both main paths that change the binding — `hotkey:capture-start` and `applyHotkeyPreference` — without changing the message.
- [x] 2.3 Unit-test the state table: `recording`, `transcribing`, and `pasting` refuse; `idle` and `error` allow.

## 3. Documentation drift

- [x] 3.1 Correct `docs/TECH-DECISIONS.md`: drop the "no application code exists" claim and record SenseVoice Small as the shipped default.
- [x] 3.2 Record the shipped capabilities in `CHANGELOG.md` under `Unreleased`.

## 4. Verification and delivery

- [x] 4.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `openspec validate --specs --strict`.
- [x] 4.2 Archive the change before merging and pin the merge to the reviewed tip.
