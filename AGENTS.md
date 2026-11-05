# AGENTS.md

Project conventions that agents and contributors must follow. This file is the
first source consulted for workflow gates; `CLAUDE.md` would take precedence
over it if present, but this repository does not have one.

## Merge gates

- `coverage-gate: never` — this project does not run `test-coverage-analyzer`
  as part of a merge. The decision was made explicitly by the project owner
  while the project has no coverage tooling configured; the recorded
  留痕 in each affected PR names this file as the decision source.
- `pr-review-gate` is unset, which means the content-matched default applies:
  review depth is chosen from the change surface and scale/risk signals
  rather than fixed in advance.

## Git workflow

- **Conflicts: rebase the feature branch, do not ask.** When a feature branch
  conflicts with its target (`main`, `release/*`), rebase it onto the target
  and resolve conflicts in place without pausing for approval. The owner
  pre-authorized this. After rebasing, push with `--force-with-lease`; never
  rewrite the protected target branch. Re-run the merge gates on the rebased
  tip.

## Testing

- `pnpm test` (Vitest) is the required suite; `pnpm typecheck`, `pnpm build`,
  and `openspec validate --specs --strict` are the other merge-gate checks.
- The real-CLI smoke test is opt-in (`JUSTSPEAK_REAL_ASR=1`) because it needs
  the downloaded model and a built runtime; a default run skipping it is
  expected, not a gap.
- New pure logic belongs in `src/core` with a unit test. Electron and DOM
  APIs stay in `main`, `preload`, and `renderer`.
