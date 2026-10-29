## Why

Round 5 found one Important boundary bug and several minors:

- `separateTail` decided the space from the masked placeholder character, so a tail starting
  with a protected term, URL, version, non-ASCII Latin word, or opening quote lost its space:
  `We go um...JustSpeak shipped.` → `We go.JustSpeak shipped.`
- The punctuation mask covered only `U+2026`; the other NFKC-expanding ellipsis/leader forms
  (`‥`, `︙`, `︰`) still became `。.`/`。..`.
- The spec never stated that a sentence-final filler retains the tail, so a truncating
  implementation would still satisfy it.
- The protected-tail test started with `Then`, exercising the path that already worked.
- `repetitionThreshold: NaN` bypassed the clamp (`Math.max(3, Math.min(10, NaN))` is NaN).
- Stray spacing before a masked punctuation run was no longer removed.

## What Changes

- Resolve the tail boundary from the first *visible* original character by unwrapping
  protect/code placeholders; insert a space for non-CJK word/digit/quote/bracket starts and no
  space for CJK text or punctuation.
- Cover `…`, `‥`, `︙`, and `︰` in the punctuation mask and the separator sets.
- Add the tail-retention and boundary requirements/scenarios to the filler spec.
- Rewrite the protected-tail test to start with the protected term.
- Reject non-finite thresholds and fall back to the default floor.
- Remove stray spaces before a punctuation run before masking hides the run, without changing
  the established full-width spacing behavior.

## Capabilities

### Modified Capabilities

- `text-postprocess`: tail boundary/retention, ellipsis/leader coverage, non-finite threshold
  handling, and pre-mask spacing.

## Impact

- `src/core/postprocess/rules.ts`: `resolveLeading`, visible-character tail boundary, ellipsis
  forms, `removeSpacesBeforePunctuation`.
- `src/core/postprocess/index.ts`: first-visible resolver, pre-mask spacing, non-finite clamp.
- `tests/postprocess.test.ts`: boundary probes, ellipsis forms, NaN, spacing, and the
  non-vacuous protected-tail test.
- No dependency, provider, paste-policy, or safety-guard change.
