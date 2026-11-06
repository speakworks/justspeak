## 1. Sidebar

- [x] 1.1 Remove the provider chip button and the `providerLabel` / `providerLive` props from `Sidebar.tsx`.
- [x] 1.2 Stop passing those props from `App.tsx`.
- [x] 1.3 Delete the `.model-chip`, `.model-dot`, and `.model-name` rules, and drop `model-chip` from the shared sidebar-item selectors.

## 2. Verification and delivery

- [x] 2.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `openspec validate --specs --strict`.
- [x] 2.2 Launch the app and confirm the sidebar footer holds only the settings entry and the settings provider row still names the model.
- [x] 2.3 Archive the change before merging and pin the merge to the reviewed tip.
