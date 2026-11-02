## Context

`postprocess()` is a pure deterministic stage. Its self-correction rule used separator
positions to delete the clause before a marker. That heuristic cannot distinguish:

- reported speech trailing off (`他说……不对，走了`), where the ellipsis run is one
  separator but `previousSeparator` treated each `…` as its own boundary;
- a marker-shaped phrase (`这个不对。`), already guarded;
- negation or quotation where the marker is part of the content.

The owner's decision is removal, not another exception. LLM correction is researched in
`docs/ASR-CORRECTION-RESEARCH.md`; the evidence supports hotwords plus an evaluation set
first and an optional constrained-decision LLM stage later.

## Decisions

### Remove the rule instead of fixing its boundary scan

Fixing `previousSeparator` to skip a whole run would make `他说……不对，走了` become `走了`,
which deletes the reported speech. Any heuristic that decides "which clause is abandoned"
eventually needs semantics. The owner chose to stop guessing: markers pass through, and a
future LLM stage may make the decision behind an explicit opt-in.

Removed together with the rule:

- the `self-correction` member of `PostprocessRule` and `POSTPROCESS_RULES`;
- the `rules['self-correction']` switch;
- `applySelfCorrections`, `findCorrectionDeletion`, `matchMarkerAt`, `previousSeparator`,
  `MARKER_PATTERN`, `MARKER_AT_START`, and the `Deletion` interface.

`SEPARATORS`, `COMMA_SEPARATORS`, `SENTENCE_SEPARATORS`, `LEADING_TRANSPARENT`,
`isLeadingPosition`, and `separatorRunEnd` remain because filler removal and casing use
them.

### `．` belongs to the punctuation-run set

`findPunctuationRunSpans` masks runs before NFKC. `．` (U+FF0E) was missing, so a run such
as `．．` was normalised to `..` and then width-converted mark by mark, yielding `。.`.
Adding it to `PUNCTUATION_RUN_CHARS` (and to the pre-run spacing cleanup) preserves the run
exactly as spoken, matching the existing atomic-run contract. A single `．` is still
NFKC-normalised to `.` and may be width-converted; only runs of two or more are protected.

### Dominant-script detection ignores masks

`dominantScript` counted Latin letters inside mask placeholders. The nonce is base36, so a
single protected term could contribute several "Latin word runs" and outvote the Han
characters. The function now skips characters between any mask start/end pair (with a depth
counter, so adjacent or nested layers are safe). Punctuation conversion then sees only the
text the user actually said. `他，JustSpeak行。` with `JustSpeak` protected stays Chinese
punctuation.

## Risks

- Users who relied on automatic "不对" cleanup lose it until the LLM stage lands. The
  research recommends "智能清理" wording and an explicit opt-in, not silent behavior.
- `applied` no longer contains `self-correction`; readers must not assume the id. The
  session/history layers treat rule ids as opaque strings, so no migration is needed.
- Full-width dot runs now survive as typed. That is the documented atomic-run behavior;
  users who want `……` must say/type it that way.
