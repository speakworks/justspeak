## 1. Tail boundary

- [x] 1.1 Add `resolveLeading` to `MaskedText` and a first-visible resolver that unwraps code then protect placeholders.
- [x] 1.2 Classify the resolved character in `separateTail`: no space for CJK text/CJK punctuation/CJK brackets; a space for non-CJK words, digits, and opening quotes/brackets.
- [x] 1.3 Add boundary probes for protected terms, URLs, versions, Greek, an opening quote, and a CJK tail; rewrite the protected-tail test to start with the protected term.

## 2. Ellipsis forms and threshold

- [x] 2.1 Add `‥`, `︙`, and `︰` to the punctuation-run, separator, and sentence-separator sets.
- [x] 2.2 Reject non-finite thresholds and fall back to the default floor of 3.
- [x] 2.3 Add tests for `他说‥然后走了`, `他说︙然后走了`, `等一下︰`, and NaN/Infinity thresholds.

## 3. Spacing and spec

- [x] 3.1 Add `removeSpacesBeforePunctuation` before the punctuation mask so `hello ... there` becomes `hello... there`.
- [x] 3.2 Add the tail-retention, boundary, ellipsis-form, non-finite, and spacing requirements/scenarios to the spec delta.
- [x] 3.3 Verify the boundary and tail mutations both turn tests red.

## 4. Verification and delivery

- [x] 4.1 Validate and archive this change; confirm `openspec validate --specs --strict`.
- [x] 4.2 Run `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- [x] 4.3 Commit on `feat/text-postprocess`, push, and update PR #6 without merging.
