## Context

At filler time the protect and code masks are still installed. A tail that begins with a
placeholder was classified from the placeholder character, which is neither Latin nor a quote,
so `separateTail` dropped the boundary. The punctuation mask also covered only one of the four
NFKC-expanding ellipsis/leader forms. The spec described the tail removal only up to the filler,
and the protected-tail test did not exercise the placeholder path.

## Goals / Non-Goals

### Goals

- Decide the tail boundary from the original visible character, after unwrapping masks.
- Preserve every NFKC-expanding ellipsis/leader form.
- Make the tail-retention, boundary, and threshold guarantees explicit in the spec and tests.
- Keep CJK tails space-free and full-width spacing behavior unchanged.

### Non-Goals

- Language detection or full sentence segmentation.
- Inserting a boundary after CJK punctuation before a Latin tail; the current tail rule is
  intentionally driven by the tail's first visible character.

## Decisions

### 1. Resolve the first visible character through the masks

`MaskedText` exposes `resolveLeading`, which returns the original text for the placeholder at
the start of a string. `removeFillers` receives a resolver that unwraps code placeholders and
then protect placeholders recursively. `separateTail` classifies the resolved character:
CJK text, CJK punctuation, and CJK opening brackets take no space; everything else (Latin,
Greek, digits, opening ASCII quote/bracket) takes one.

- **Why**: the placeholder is an implementation detail; the original decides whether a word
  boundary is needed. Resolving before restore keeps the space in the final text.
- **Alternatives**: insert a space after restore — rejected because the filler function no
  longer knows where the boundary was; restore first — rejected because it would expose
  protected tokens to filler edits.
- **Consequences**: a protected term, URL, version, or Greek word after a removed run gets the
  expected space; a CJK tail does not.

### 2. Cover all four NFKC-expanding ellipsis/leader forms

`…`, `‥`, `︙`, and `︰` are added to the punctuation-run set, the separator sets, and the
ellipsis detection. A single occurrence is masked because NFKC expands each one.

- **Why**: masking only U+2026 left the other forms to be split into `。.`/`。..`.
- **Consequences**: the spec lists the four forms explicitly instead of claiming "every
  ellipsis character".

### 3. Pre-mask spacing cleanup is narrow

`removeSpacesBeforePunctuation` removes whitespace before the first mark of a run while the run
is still visible. The full `normalizeText` still runs after masking for NFKC, punctuation
conversion, and the established full-width spacing rules.

- **Why**: masking hides the run from the full spacing pass; doing only the narrow cleanup
  fixes `hello ... there` without removing spaces after full-width commas in Latin-dominant
  text.
- **Consequences**: `normalize` is reported once if either the pre-step or the full pass
  changes the text.

### 4. Non-finite thresholds fall back

`postprocess` checks `typeof threshold === 'number' && Number.isFinite(threshold)` before the
clamp. NaN, Infinity, and -Infinity use the default floor of 3.

- **Why**: `Math.max(3, Math.min(10, NaN))` is NaN, which disables collapse entirely and
  bypasses the documented floor.
- **Consequences**: a direct caller passing NaN gets the default behavior; the parser already
  rejects non-integers.

## Risks / Trade-offs

- A tail starting with a CJK opening bracket gets no space; that is consistent with CJK
  typography and avoids a regression.
- The resolver unwraps at most eight nested placeholders; nested masks are at most two levels,
  so the bound is generous.
- `hello!!` remains preserved (round 3's decision); this change does not revisit it.

## Migration Plan

- Behavior changes only for tail boundaries after a removed run and the extra ellipsis forms.
- Rollback is reverting the branch.

## Open Questions

- Whether a CJK punctuation mark followed by a Latin tail should get a space; the current rule
  keys on the tail and inserts one for non-CJK text.
