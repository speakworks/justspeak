## Context

Normalisation handles punctuation one character at a time. NFKC expands `…` to `...`, the
dominant-script conversion turns the first dot of a Han-adjacent run into `。`, and repetition
collapses the remainder, producing `。.`. The same path would split expressive runs. The
threshold parser also accepts 2 while the stage clamps to 3, so the documented keep-list-at-2
behavior is unreachable.

## Goals / Non-Goals

### Goals

- Preserve ellipses and other punctuation runs exactly as spoken.
- Make the Han threshold contract, parser, stage, and spec agree at a floor of 3.
- Pin the purity and provider-failure guarantees with tests.
- Keep filler removal able to consume a run.

### Non-Goals

- Restoring the card's original "drop duplicated trailing punctuation" behavior. Review 3
  explicitly requires runs to survive intact; that supersedes the earlier clause.
- Sentence splitting, smart-quote conversion, or language-aware ellipsis styling.

## Decisions

### 1. Punctuation runs are a third mask layer

`findPunctuationRunSpans` selects every run of two or more punctuation marks and every
occurrence of `…`. The runs are masked with a third disjoint namespace (`U+E004/U+E005`)
before NFKC, restored immediately after normalisation, and then left alone by the remaining
rules. Filler/self-correction removal runs after the restore, so it can still consume the run.

- **Why**: masking before NFKC is the only way to stop `……` from becoming `......`; masking
  before the width conversion is the only way to stop the first dot from becoming `。`.
  Restoring before fillers preserves the separator semantics.
- **Alternatives**: post-hoc repair of `。.` — rejected because it cannot recover the original
  run shape (`...` vs `……` vs `…`).
- **Consequences**: `hello!!` now remains `hello!!` instead of collapsing to `hello!`; the
  repetition rule no longer has a punctuation clause. This is the review's explicit choice.

### 2. Threshold floor of 3

`parseVocabularyConfig` accepts only 3–10. The stage clamps any direct caller below 3 up to 3.
The keep list remains in the code for a future lower floor but is not reachable through
configuration.

- **Why**: two-character Han reduplication is productive; a 2 threshold mangles idioms outside
  a finite list. A floor makes the code and spec honest.
- **Alternatives**: allow 2 and restore the whitelist trade-off — rejected by the review.
- **Consequences**: a stored `repetitionThreshold: 2` is ignored and the default 3 applies.

### 3. Tests pin the guarantees

A source-scan test asserts the module imports no Electron/DOM/filesystem/network APIs. A
session test injects a `postprocess` spy and a failing provider and asserts the spy is never
called. The threshold clamp test uses `repetitionThreshold: 2` and expects the floor behavior;
the ellipsis tests cover the four probes plus a filler-consumes-run case.

## Risks / Trade-offs

- Preserving runs means `hello!!` is no longer normalized; the user's emphasis wins. This
  supersedes the original card clause and is recorded in the proposal.
- The punctuation mask adds a third placeholder namespace; the disjointness and sentinel-leak
  guards extend to it automatically through `MASK_MARKERS`/`MASK_SENTINELS`.
- A lone `…` is masked even though it is one character, because NFKC would expand it.

## Migration Plan

- Default behavior changes only for punctuation runs (preserved) and threshold 2 (raised to 3).
- Rollback is reverting the branch.

## Open Questions

- Whether a future setting should allow expressive-run preservation to be disabled; not needed
  for this card.
