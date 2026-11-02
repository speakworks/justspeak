## 1. Remove the self-correction rule

- [x] 1.1 Replace the self-correction tests with pass-through tests for `不对`, `我是说`, `no wait`, `I mean`, and the ellipsis case
- [x] 1.2 Remove `self-correction` from `PostprocessRule`, `POSTPROCESS_RULES`, and the rule-switch tests
- [x] 1.3 Remove `applySelfCorrections`, its marker helpers, and the unused separator helper from `rules.ts`
- [x] 1.4 Remove the rule from `postprocess()` and keep casing driven only by filler removals

## 2. Deterministic fixes

- [x] 2.1 Add `．` (U+FF0E) to the punctuation-run set and pre-run spacing cleanup; test `他说．．` and `他说．．然后走了`
- [x] 2.2 Make `dominantScript` skip mask placeholders with a depth counter; test protected `JustSpeak` in a Chinese sentence
- [x] 2.3 Confirm the existing normalisation, filler, repetition, vocabulary, and masking tests still pass

## 3. Contract and docs

- [x] 3.1 OpenSpec delta: remove the self-correction requirement; modify normalisation, repetition, and rule-disableability requirements
- [x] 3.2 Record the removal decision and the research outcome in `docs/PRODUCT-FEEDBACK.md`
- [x] 3.3 Update `docs/ASR-CORRECTION-RESEARCH.md` with the accepted next step (rules removed; LLM research pending)
- [ ] 3.4 At archive time, update the main spec Purpose sentence (OpenSpec keeps the existing Purpose and ignores a delta Purpose)

## 4. Verification

- [x] 4.1 `pnpm test` (625 passed, 4 skipped)
- [x] 4.2 `pnpm typecheck`
- [x] 4.3 `openspec validate postprocess-cleanup --strict` and `openspec validate --specs --strict`
