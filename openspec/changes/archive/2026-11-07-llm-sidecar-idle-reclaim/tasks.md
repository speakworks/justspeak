## 1. Idle reclaim

- [x] 1.1 Add `localIdleTimeoutMs` to the corrector deps (default 5 minutes, `0` disables) and arm the timer once the sidecar is ready.
- [x] 1.2 Refresh the timer after every completed decision; never reclaim while a decision is in flight.
- [x] 1.3 On expiry, stop the sidecar and report `idle` (not `failed`), so the settings row still reports the model as available.
- [x] 1.4 Clear the timer on backend change, dispose, and any other stop.

## 2. Verification and delivery

- [x] 2.1 Unit-test reclaim + lazy restart, and the in-flight guard, with a short injectable window.
- [x] 2.2 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `openspec validate --specs --strict`.
- [x] 2.3 Archive the change before merging and pin the merge to the reviewed tip.
