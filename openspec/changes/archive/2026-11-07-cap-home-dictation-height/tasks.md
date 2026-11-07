## 1. Layout

- [x] 1.1 Cap 首页's sheet at 300 px with a destination-specific class, leaving the shared `.sheet` rule alone (历史记录 reuses it).
- [x] 1.2 Top-align the capped card so the space below it stays empty.

## 2. Verification and delivery

- [x] 2.1 Assert in the Electron E2E: the card is at most 300 px tall, the pane gains no scrollbar, and long text scrolls inside the input without growing the card.
- [x] 2.2 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm exec playwright test`, and `openspec validate --specs --strict`.
- [x] 2.3 Archive the change before merging and pin the merge to the reviewed tip.
