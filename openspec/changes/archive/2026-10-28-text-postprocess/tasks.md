## 1. Core post-processing module

- [x] 1.1 Add `src/core/postprocess/types.ts` with `PostprocessOptions`, `PostprocessResult`, the five rule ids, and the `Vocabulary` shape; verify `pnpm typecheck`.
- [x] 1.2 Add `src/core/postprocess/vocabulary.ts` with config parsing (array and map `replace`, `protect` filtering, boolean rules, threshold bounds), longest-first case-insensitive ASCII replacement on word boundaries, literal CJK replacement, and protect-span discovery; verify parser and boundary tests pass.
- [x] 1.3 Add `src/core/postprocess/rules.ts` with NFKC, dominant-script punctuation conversion, whitespace cleanup, protect/code masking, filler removal, self-correction fragment deletion, and thresholded repetition collapse with keep lists; verify table-driven tests pass.
- [x] 1.4 Add `src/core/postprocess/index.ts` with the ordered pipeline, truthful `applied` ids, per-rule switches, and the non-empty-input guard; verify filler-only and whitespace-only inputs return the original.

## 2. Wiring

- [x] 2.1 Add an optional `postprocess` dependency to `SessionController`, call it after a successful provider result and before `sendTranscript`/`paste`, record `applied`, and fall back to the raw text if the stage returns empty; verify fake and real-provider wiring tests pass.
- [x] 2.2 Add `src/main/vocabulary-store.ts` for `userData/vocabulary.json` mirroring `ThemeStore` (missing/corrupt files resolve to defaults) and load it once at startup into the session dependency.
- [x] 2.3 Extend `TranscriptEvent` additively with `applied?: string[]`, keep the preload pass-through unchanged, and show the applied-rule count in the existing transcript meta line; verify `pnpm build`.

## 3. Tests

- [x] 3.1 Add `tests/postprocess.test.ts`: normalisation, code tokens, Chinese/English/mixed fillers, false-positive fillers, each correction marker, repetition threshold and keep cases, vocabulary replace/protect, each rule isolated and disabled, empty/whitespace-only safety, and plain-prose pass-through.
- [x] 3.2 Add `tests/preferences.test.ts`: config parsing (array/map, unknown keys, bad types, threshold bounds), store round-trip and directory creation, missing/corrupt/non-object payloads, file separation from `preferences.json`, and loaded-config integration with `postprocess`.
- [x] 3.3 Add session tests for processed-before-paste, real-provider processing, `applied` recording, and the empty-output fallback.

## 4. Verification and delivery

- [x] 4.1 Run `pnpm typecheck`, `pnpm test`, and `pnpm build`; record the command output in the run report.
- [x] 4.2 Archive the change and confirm `openspec validate --specs --strict` passes.
- [x] 4.3 Commit on `feat/text-postprocess`, push, and open a PR against `main` without merging; record the URL.
