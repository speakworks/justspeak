## 1. Core logic

- [x] 1.1 Add batch import parsers for terms/protect (line split, trim, blank skip, exact de-duplication, duplicate count) and replacements (`from => to`, invalid lines counted, de-duplication by `from`).
- [x] 1.2 Add save-payload normalisation that reuses `parseTermList` and the existing replace/protect parsers.
- [x] 1.3 Extend the vocabulary summary view with the accepted entries while keeping the existing count fields and copy.
- [x] 1.4 Add the starter-list plan (existing first, missing starter terms appended) and expose the resource terms on the view from main.

## 2. Persistence

- [x] 2.1 Write `vocabulary.json` through a same-directory temporary file plus rename, cleaning the temporary file and leaving the original untouched on failure.
- [x] 2.2 Add the testable save-and-read-back step that rejects malformed payloads, saves, re-reads, and returns the options the next dictation must use.

## 3. IPC and main

- [x] 3.1 Add `VocabularySavePayload` / `VocabularySaveResult`, the preload bridge, and the `vocabulary:save` handler.
- [x] 3.2 On success update `postprocessOptions` from the read-back, push the new view, and return it; on failure return a reason without touching any state.

## 4. Renderer

- [x] 4.1 Render the three editable sections with add, edit, delete, and batch paste, showing duplicate and invalid-line counts.
- [x] 4.2 Add the save action with busy state, success copy from the read-back counts, and an error that preserves the draft.
- [x] 4.3 Keep the provider-unsupported notice visible and use existing classes and Chinese copy.
- [x] 4.4 Add `载入起始词表（10 词）`: merge into the draft, save only on click, and show `已全部载入` without a write when complete.
- [x] 4.5 Add the `起始词表与载入方式` section to `docs/VOCABULARY.md`.

## 5. Tests

- [x] 5.1 Cover batch import: empty text, blank lines, duplicates, CJK+ASCII, missing arrow, one empty side, more than 32 entries, comma terms.
- [x] 5.2 Cover atomic save on write and rename failure, payload normalisation equality, empty saves, old files without `terms`, and the read-back options used by the next session.
- [x] 5.3 Cover the existing `describeVocabulary` copy and an unreadable file's explicit reason.
- [x] 5.4 Pin the starter JSON at ten parseable comma-free terms, and cover merge idempotence, partial merge order, the complete/no-write decision, and the read-back count.

## 6. Verification and delivery

- [x] 6.1 Run `pnpm typecheck`, `pnpm exec vitest run`, `pnpm build`, and `openspec validate --specs --strict`.
- [x] 6.2 Archive the change, re-run the gates, and ship one branch, one commit, and one pull request.
