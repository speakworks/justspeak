# asr-vocabulary-bias Tasks

## 1. OpenSpec

- [x] 1.1 `proposal.md` records the decode-time rationale, evidence, and non-goals
- [x] 1.2 `specs/asr-vocabulary-bias/spec.md` covers priority, degradation,
      no-rewrite, backward compatibility, and the 32-term cap with visible reasons
- [x] 1.3 `openspec validate asr-vocabulary-bias --strict` passes

## 2. Vocabulary file parsing (src/core, src/main)

- [x] 2.1 `src/core/postprocess/types.ts`: add a `TermListParse` shape carrying
      the accepted `terms`, the discarded count, and per-reason counts; do not
      extend `Vocabulary` (`replace` / `protect`) with terms
- [x] 2.2 `src/core/postprocess/vocabulary.ts`: parse top-level `terms` with
      trim, exact de-duplication in first-occurrence order, empty-entry removal,
      the 32-entry cap, and U+002C rejection; missing or invalid input resolves
      to `[]` without throwing
- [x] 2.3 `src/core/postprocess/vocabulary.ts`: keep `parseVocabularyConfig`
      dropping unknown keys so old files and old callers are unchanged
- [x] 2.4 `src/core/postprocess/vocabulary.ts`: `serializeVocabularyConfig`
      preserves accepted `terms` so a save never erases them
- [x] 2.5 `src/main/vocabulary-store.ts`: surface the parse result on
      `VocabularyLoadResult` (terms plus discard counts) without changing the
      `options` contract consumed by the post-processing stage
- [x] 2.6 `src/shared/ipc.ts`: extend `VocabularySummary` with `termCount` and
      the comma-discard count; never add term strings

## 3. Capability bit and catalog

- [x] 3.1 `src/core/asr/types.ts`: add `vocabularyBias: boolean` to
      `AsrCapabilities`
- [x] 3.2 `src/core/asr/model-catalog.ts`: require the boolean in
      `isCapabilities` so a missing or non-boolean value fails closed
- [x] 3.3 `src/core/asr/qwen3-provider.ts`: declare `vocabularyBias: true`
- [x] 3.4 `src/core/asr/sensevoice-provider.ts`: declare `vocabularyBias: false`
- [x] 3.5 `src/core/asr/fake-provider.ts`: declare `vocabularyBias: false`
- [x] 3.6 `resources/models.json`: declare `vocabularyBias` for both models
      (Qwen3 true, SenseVoice false)
- [x] 3.7 Update every other `AsrCapabilities` literal found by
      `grep -rn "maxAudioMs:" src tests` so the build stays type-clean

## 4. Runner arguments and request wiring

- [x] 4.1 `src/main/asr/cli-runner.ts`: accept the accepted terms in the run
      options and append one ordered `--vocabulary` argument before the audio
      path when terms are present
- [x] 4.2 `src/main/asr/cli-runner.ts`: never send `--vocabulary` for an empty
      list; leave `-q`, `-m`, and the audio path untouched
- [x] 4.3 `src/core/asr/inference-provider.ts`: read `TranscribeOptions.vocabulary`
      (currently declared at `src/core/asr/types.ts:71` and unused) and pass it
      to the runner only when `capabilities.vocabularyBias` is true
- [x] 4.4 `src/main/index.ts`: populate `TranscribeOptions.vocabulary` from the
      vocabulary store's accepted terms at each transcription call site
- [x] 4.5 Confirm terms never reach `postprocessOptions.vocabulary`

## 5. Degradation paths

- [x] 5.1 Unsupported provider: attach `ProviderWarning` code
      `VOCABULARY_UNSUPPORTED` to the result; text unchanged; settings readback
      reports it
- [x] 5.2 Empty term list: neither pass the flag nor emit a vocabulary warning
- [x] 5.3 Unknown-flag retry: detect the CLI diagnostic for an unrecognised
      option in `src/main/asr/cli-runner.ts`, retry the same input once without
      `--vocabulary`, and attach `VOCABULARY_UNSUPPORTED` on success
- [x] 5.4 Do not retry for unrelated inference failures, and never retry twice
- [ ] 5.5 Runtime truncation: verify whether the pinned CLI emits a recognised
      truncation line on stderr; if it does, map it to `VOCABULARY_TRUNCATED`,
      otherwise leave the success result warning-free and record the
      **unconfirmed** detection in the change notes.
      **PENDING — live stderr not observed.**

## 6. Settings readback and diagnostics

- [x] 6.1 `src/core/preferences/view.ts`: `describeVocabulary` reports
      术语 N 条 / 替换 N 条 / 保护 N 条
- [x] 6.2 `src/core/preferences/view.ts`: show the comma-discard count as a
      visible reason
- [x] 6.3 `src/core/preferences/view.ts` (or the provider row): state that the
      active provider does not use terms, derived from `vocabularyBias`
- [x] 6.4 `src/main/index.ts` (`summarizeVocabulary`): add `termCount` from the
      accepted list only
- [x] 6.5 Confirm the diagnostics bundle still excludes vocabulary file contents
      and term strings (`src/main/index.ts:951` comment and the export filters)

## 7. Tests

- [x] 7.1 Unit: `tests/postprocess-vocabulary.test.ts` or the existing
      vocabulary test file covers missing `terms`, trim/dedup/order, the cap,
      comma rejection, invalid shapes, and save round-trip
- [x] 7.2 Unit: `tests/cli-runner.test.ts` covers the ordered flag, the empty
      list, the unknown-flag retry (once), and no retry for unrelated failures
- [x] 7.3 Unit: `tests/inference-provider.test.ts` or equivalent covers
      capability-gated forwarding and the `VOCABULARY_UNSUPPORTED` warning
- [x] 7.4 Unit: catalog parsing rejects an entry without `vocabularyBias`
- [x] 7.5 Unit: `describeVocabulary` renders the three counts, the discard
      reason, and the unsupported-provider state
- [x] 7.6 Unit: diagnostics summary carries counts and no term strings
- [x] 7.7 Integration: a fake runner records the spawned argv for Qwen3 versus
      SenseVoice
- [ ] 7.8 Optional: extend the opt-in real-CLI smoke test
      (`JUSTSPEAK_REAL_ASR=1`, `tests/real-cli.smoke.test.ts`) to exercise
      `--vocabulary`; skip remains expected by default
      **SKIPPED — optional; the default run does not exercise it.**

## 8. Documentation

- [x] 8.1 Document `terms` and the 32-entry/comma limits in the user-facing
      vocabulary documentation
- [x] 8.2 Record the SenseVoice limitation and the 0.6B echo risk where the
      vocabulary behavior is documented
- [x] 8.3 Re-run `tests/docs-drift.test.ts` after documentation edits

## 9. Verification

- [x] 9.1 `pnpm test`
- [x] 9.2 `pnpm typecheck`
- [x] 9.3 `pnpm build`
- [x] 9.4 `openspec validate --specs --strict`
- [x] 9.5 `openspec validate asr-vocabulary-bias --strict`

## 10. Delivery

- [ ] 10.1 `openspec archive asr-vocabulary-bias` after verification (same PR)
      **PENDING — archive deliberately not performed in this pass.**
- [ ] 10.2 Commit and open a PR against `main` (no merge)
      **PENDING — no commit or PR by instruction.**
