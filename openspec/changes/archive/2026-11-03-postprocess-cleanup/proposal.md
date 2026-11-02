## Why

The rule-based self-correction stage deletes the clause before markers such as `不对`,
`我是说`, `no wait`, and `I mean`. Real transcripts show it misreads ellipses, reported
speech, and negation: `他说……不对，走了` becomes `他说… 走了` because the ellipsis run is
treated as several separators. The owner decided to remove the heuristic entirely rather
than add more exceptions; LLM-based correction is a separate, researched direction
(`docs/ASR-CORRECTION-RESEARCH.md`).

Two deterministic defects surfaced in the same review:

- `他说．．` (two full-width full stops) became `他说。.` because `．` (U+FF0E) was not part
  of the punctuation-run set, so NFKC split the run before the width conversion.
- `他，JustSpeak行。` with `JustSpeak` protected became `他,JustSpeak行.` because the mask
  placeholder's base36 nonce counted as Latin word runs and flipped the sentence to
  English for punctuation conversion.

## What Changes

- Remove the `self-correction` rule, its `applied` id, and its configuration switch.
  Text containing correction markers now passes through unchanged.
- Treat `．` as a punctuation-run mark: a run of two or more full-width dots survives
  exactly as spoken instead of being split by NFKC.
- Make dominant-script detection ignore masked spans, so protected terms and code-like
  tokens cannot flip a Chinese sentence to the Latin punctuation branch.
- Update the text-postprocess spec and tests; leave an LLM correction stage to a future
  change, with the research and Go/No-Go criteria recorded.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `text-postprocess`: removes the self-correction requirement; narrows repetition's
  punctuation-consumption rule to filler removal; extends normalisation for full-width
  dot runs and mask-insensitive script detection; drops `self-correction` from the
  disableable rule set.

## Impact

- `src/core/postprocess/{types,index,rules}.ts`, `tests/postprocess.test.ts`.
- `docs/PRODUCT-FEEDBACK.md` item 7 and `docs/ASR-CORRECTION-RESEARCH.md` status.
- No IPC, session, settings, or history schema change: `applied` loses one possible id,
  which existing readers already treat as an open string list.
