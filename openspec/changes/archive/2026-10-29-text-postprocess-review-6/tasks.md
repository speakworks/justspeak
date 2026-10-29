## 1. Placeholder opacity

- [x] 1.1 Report `placeholderSpans` from `maskSpans` (including preserved ranges shifted past new spans) and accept preserved ranges as an argument.
- [x] 1.2 Make `findCodeSpans` and `findPunctuationRunSpans` skip any match that intersects an excluded range; pass the ranges through all three mask layers.
- [x] 1.3 Add the exclusion unit test and the protected-term/ellipsis probes; verify mutating the exclusion turns the test red.

## 2. CJK punctuation policy

- [x] 2.1 Choose no space after CJK sentence punctuation; add `CJK_SENTENCE_MARKS` and suppress the tail space.
- [x] 2.2 Add `我们走 um。Then home.` → `我们走。Then home.` and keep the existing CJK-tail case.

## 3. Spec and known limitations

- [x] 3.1 Update the filler requirement with the CJK punctuation policy and scenario.
- [x] 3.2 Update the masking requirement with placeholder opacity and scenarios.
- [x] 3.3 Record the three known limitations in the design and PR body.

## 4. Verification and delivery

- [x] 4.1 Validate and archive this change; confirm `openspec validate --specs --strict`.
- [x] 4.2 Run `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- [x] 4.3 Commit on `feat/text-postprocess`, push, and update PR #6 without merging.
