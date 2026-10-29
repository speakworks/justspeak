## Context

The masks are installed in layers: protect, then code, then punctuation runs. Later span
detectors originally scanned the whole masked string. A protect placeholder's interior is
Latin/digit text (nonce and id), so it can match a code pattern (a nonce starting with a digit
plus `s` matches the number-unit rule). Masking that interior splits the protect placeholder;
`resolveLeading` cannot resolve it and the filler boundary sees a PUA character.

The tail boundary also added a space after CJK sentence punctuation, while `normalizeSpacing`
strips spaces after `。`; the spec said a space was always inserted.

## Goals / Non-Goals

### Goals

- Placeholders are opaque to every later span detector, independent of the nonce format.
- One documented CJK punctuation policy that code and spec share.
- Tests that fail if either behavior regresses.

### Non-Goals

- Fixing the three recorded known limitations.
- Language-aware spacing after CJK punctuation; the chosen policy is no space.

## Decisions

### 1. Placeholder ranges, not nonce inspection

`MaskedText` reports `placeholderSpans`: the ranges of every placeholder in `masked`,
including ranges passed in from earlier layers (shifted past newly inserted spans).
`findCodeSpans(text, excluded)` and `findPunctuationRunSpans(text, excluded)` skip any match
that intersects an excluded range. The pipeline passes the protect ranges to the code mask and
the combined ranges to the punctuation mask. `maskSpans` accepts the preserved ranges and
shifts them with a delta table.

- **Why**: the invariant is "placeholders are opaque", not "the nonce happens to avoid this
  regex". A future nonce change cannot reintroduce the split.
- **Alternatives**: change the nonce prefix to a letter — rejected as a format special-case
  that would break again; detect code before masking — rejected because protect spans shift
  positions and the two layers would need a combined masking pass.
- **Consequences**: a code-like match that partially overlaps a placeholder is skipped
  entirely; the protected token is more important than masking its neighbours.

### 2. No space after CJK sentence punctuation

`CJK_SENTENCE_MARKS` (`。`, `！`, `？`, `…`, `‥`, `︙`, `︰`) suppresses the tail space. A CJK
mark already separates the clauses; `normalizeSpacing` strips spaces after `。` anyway.

- **Why**: one policy, code and spec agree, and the output is typographically consistent with
  the rest of the Chinese rules.
- **Consequences**: `我们走 um。Then home.` → `我们走。Then home.`; an ASCII mark keeps the
  boundary logic.

### 3. Known limitations are recorded, not patched

The three items in the proposal are documented in the PR and this design. They are edge cases
outside the root causes and the review explicitly asked not to spend code on them.

## Risks / Trade-offs

- Skipping an entire code match that overlaps a placeholder can leave neighbouring literal
  punctuation unmasked; the protect token's integrity is the priority.
- The CJK policy means a Latin sentence after a Chinese `。` has no space; that follows the
  chosen typography.
- `resolveLeading` remains untested by construction; the opacity range tests cover its failure
  mode end to end.

## Migration Plan

- No config or API change; behavior changes only at placeholder boundaries.
- Rollback is reverting the branch.
