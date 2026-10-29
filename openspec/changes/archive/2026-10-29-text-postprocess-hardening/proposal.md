## Why

Review found silent transcript corruption and several rule-quality defects:

- The protect and code masks shared one `<id>` sentinel namespace, so restoring the code layer
  rewrote protect placeholders. `JustSpeak v1.2.3 is out.` with `JustSpeak` protected became
  `v1.2.3 v1.2.3 is out.` with `applied: []`.
- Vocabulary ran over text that already contained mask placeholders, so a numeric replacement
  could edit the mask encoding and leak invisible characters while losing protected text.
- Casing ran unconditionally, so lowercase plain prose (`hello, world`), code commands
  (`pnpm test`), and mid-sentence changes were capitalised against the spec.
- A leading or trailing filler left its sentence separator behind (`Um. We should go.` became
  `. We should go.`).
- The email regex rescanned from every position and was quadratic on long tokens.

## What Changes

- Give the protect and code masks disjoint sentinel namespaces; each restore matches only its
  own layer. Add a final invariant that returns the original text if any sentinel remains.
- Run vocabulary only over text between protected and code-like spans, so it can never rewrite
  a user literal or a mask id.
- Run casing only when a rule actually removed material at the start of the text, and extend
  the code-token guard to bare multi-word commands (`pnpm test`, `npm run build`, `git commit`).
- Remove orphan sentence separators left by leading and sentence-final fillers.
- Anchor and bound the email pattern so long tokens stay linear.
- Reconcile the `text-postprocess` spec with the narrowed casing trigger and new invariants.

## Capabilities

### Modified Capabilities

- `text-postprocess`: mask-layer safety, vocabulary/exclusion ordering, casing trigger and
  code-command coverage, orphan-separator handling, and bounded long-input behavior.

## Impact

- `src/core/postprocess/vocabulary.ts`: `applyVocabularyOutside`, shared `mergeSpans`.
- `src/core/postprocess/rules.ts`: layer namespaces, `containsSentinel`, narrowed filler
  results with `removedLeading`, orphan-separator removal, command and email patterns.
- `src/core/postprocess/index.ts`: vocabulary exclusion, disjoint masks, conditional casing,
  fail-closed sentinel guard.
- `tests/postprocess.test.ts`: the regression probes and the mask/vocabulary/casing/perf cases.
- No dependency, provider, paste-policy, or safety-guard change.
