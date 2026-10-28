## 1. Punctuation runs

- [x] 1.1 Add the `punctuation` mask layer (`U+E004/U+E005`) and `findPunctuationRunSpans` for runs of two or more marks and every ellipsis.
- [x] 1.2 Mask runs before NFKC and restore them immediately after normalisation, before self-correction/filler, so a filler can still consume a run.
- [x] 1.3 Remove the punctuation-collapse clause from repetition; runs survive except when a filler or correction consumes them.
- [x] 1.4 Add tests for `他说……`, `他说...`, `他说…`, `等一下……`, `真的吗?!`, `hello!!`, `真的。。`, and the filler-run cases.

## 2. Threshold floor

- [x] 2.1 Accept only 3–10 in `parseVocabularyConfig` and clamp direct callers to a floor of 3.
- [x] 2.2 Replace the unreachable keep-list-at-2 test with a floor test (`我我走了。` unchanged, `我我我走了。` → `我走了。`).
- [x] 2.3 Add a parser test that a stored threshold of 2 is ignored.

## 3. Missing tests and wording

- [x] 3.1 Add a source-surface purity test for `src/core/postprocess/**` (no Electron, DOM, filesystem, or network imports).
- [x] 3.2 Add a session test that a failing provider never calls the post-processing spy.
- [x] 3.3 Reword the filler requirement to distinguish leading (whole run) from sentence-final (at most one mark) removal.
- [x] 3.4 Confirm no probe scripts were left in the repo; probes run from `/tmp` or inline `tsx -e`.

## 4. Verification and delivery

- [x] 4.1 Validate and archive this change; confirm `openspec validate --specs --strict`.
- [x] 4.2 Run `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- [ ] 4.3 Commit on `feat/text-postprocess`, push, and update PR #6 without merging.
