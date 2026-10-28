## 1. Mask and vocabulary safety

- [x] 1.1 Give the protect and code masks disjoint sentinel namespaces, make `maskSpans` take a layer, and restore each layer with its own pattern.
- [x] 1.2 Add `applyVocabularyOutside` and shared `mergeSpans`; exclude protected and code-like spans from vocabulary, then re-detect spans for masking.
- [x] 1.3 Add `containsSentinel` and return the original input with `applied: []` when a sentinel survives restoration.
- [x] 1.4 Extend the code-span detector to bare multi-word commands (`pnpm test`, `npm run build`, `git commit`) and correct the pipeline comment.

## 2. Casing, fillers, and long input

- [x] 2.1 Return `removedLeading` from self-correction and filler removal; run casing only when it is true.
- [x] 2.2 Remove orphan separators for leading and sentence-final fillers.
- [x] 2.3 Anchor and bound the email pattern so a 60,000-character token stays well under one second.

## 3. Tests

- [x] 3.1 Add the protect + version / + email / + URL, protect + numeric replacement, and multi-span regression cases.
- [x] 3.2 Add the mask-namespace disjointness test, the sentinel-leak fail-closed test, and no-sentinel assertions.
- [x] 3.3 Add vocabulary/code-span tests, bare-command tests, plain lowercase prose, casing-only-after-drop, orphan-separator cases, and the long-token timing test.
- [x] 3.4 Revert the expectations that assumed unconditional casing and keep the never-empty guard covered.

## 4. Verification and delivery

- [x] 4.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `openspec validate --specs --strict`.
- [ ] 4.2 Archive this change, commit on `feat/text-postprocess`, push, and update PR #6 without merging.
