## 1. Separator runs

- [x] 1.1 Add `…` to the separator sets and a `separatorRunEnd` helper; consume the whole run in leading and sentence-final filler removal.
- [x] 1.2 Consume the whole trailing separator run in `applySelfCorrections`, including chained markers.
- [x] 1.3 Add tests for `um... hello`, `um.... hello`, `um?? hello`, `um...`, `um?!`, `嗯……我们走吧。`, `No wait... Tuesday.`, and sentence-final runs.

## 2. Han reduplication

- [x] 2.1 Default the Han repetition threshold to 3, keep Latin word repeats at 2, and make the keep list an extra guard only at threshold 2.
- [x] 2.2 Add tests for `默默无闻`, `冉冉升起`, `匆匆忙忙`, `津津有味`, `欣欣向荣`, `我我我`, `the the`, and `谢谢` at threshold 2.
- [x] 2.3 Update the threshold documentation in `types.ts` and `index.ts`.

## 3. Mask restore and regression tests

- [x] 3.1 Derive a deterministic per-call nonce that is absent from the input and use it in the placeholder/restore pattern.
- [x] 3.2 Add tests for sentinel-shaped user text, a rule-changing sentinel-bearing text, determinism across calls, and the namespace test with nonce-length placeholders.
- [x] 3.3 Rewrite the numeric-replacement test so a plain `1` must be replaced; verify deleting the fail-closed guard makes a test fail.

## 4. Spec reconciliation

- [x] 4.1 Add this change's delta: separator runs, Han/Latin thresholds, correction runs, call-scoped restore, and vocabulary span-exclusion wording.
- [x] 4.2 Edit the main spec Purpose to include casing and separator-run removal; archive the change and validate the specs.

## 5. Verification and delivery

- [x] 5.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `openspec validate --specs --strict`.
- [ ] 5.2 Commit on `feat/text-postprocess`, push, and update PR #6 without merging.
