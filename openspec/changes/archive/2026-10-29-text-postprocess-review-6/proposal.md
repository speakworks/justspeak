## Why

The final review found two root causes:

- Code-span detection ran over protect-masked text and could inspect a placeholder's
  interior. A nonce/id such as `7s` matched the number-unit pattern, splitting the protect
  placeholder; `resolveLeading` then failed and the raw PUA character was classified as
  non-CJK. `我们走 um……张三来了。` produced a stray space before the protected name.
- `separateTail` inserted a space after a CJK sentence mark, but `normalizeSpacing` strips
  whitespace after `。`, so the spec ("space SHALL be inserted") and the code disagreed.

## What Changes

- Make placeholders opaque to later span detection. `maskSpans` reports every placeholder range
  in its output (including pass-through ranges shifted past new spans);
  `findCodeSpans`/`findPunctuationRunSpans` accept those ranges and skip any match that
  intersects them. No nonce-format special-casing.
- Settle the CJK punctuation policy: do **not** insert a space after CJK sentence punctuation
  (`。`, `！`, `？`, `…`, `‥`, `︙`, `︰`). The mark already provides the boundary; the spec now
  says so.
- Add the protected-term + ellipsis probes, the CJK-punctuation probe, and a direct
  exclusion test for `findCodeSpans`.
- Record three known limitations rather than fixing them: protect entries with leading
  whitespace, astral-plane Han classification, and the untested `resolveLeading`.

## Capabilities

### Modified Capabilities

- `text-postprocess`: placeholder opacity in span detection and the CJK sentence-punctuation
  boundary policy.

## Impact

- `src/core/postprocess/rules.ts`: `placeholderSpans`/`preserved` ranges, excluded-aware
  `findCodeSpans`/`findPunctuationRunSpans`, CJK sentence-mark policy.
- `src/core/postprocess/index.ts`: pass the ranges through the three masks, post-restore
  spacing cleanup.
- `tests/postprocess.test.ts`: opacity probes, exclusion test, CJK policy test.
- No dependency, provider, paste-policy, or safety-guard change.

## Known limitations (recorded, not fixed)

- A protect entry with leading whitespace (for example ` JustSpeak`) can produce a double
  space when it is restored at a tail boundary.
- Astral-plane Han (for example `𠀀`) is judged by a lone surrogate, so the boundary code may
  insert a space before it.
- `resolveLeading` has no dedicated test. A stub that always returns `undefined` still passes
  the current tail tests, so its recursion is untested; this is noted rather than covered by a
  vacuous assertion.
