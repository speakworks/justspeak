## Context

`docs/LLM-POSTPROCESSING.md` accepts Option A, a rule-based baseline, as the v0.1 default: it is
offline, deterministic, and keeps transcript text on the device. The current session controller
goes straight from `provider.transcribe(...)` to `paste(text)`, so no cleanup exists. This change
adds the stage without touching the ADR-0003 provider contract or the paste policy, and leaves
LLM cleanup (a network/cost decision) out of scope.

Constraints:

- `src/core` stays free of Electron, DOM, and OS APIs (ADR-0001).
- No new runtime dependency for Unicode normalisation; Node provides NFKC.
- Fake and local providers must behave identically through the stage.
- A dictation must never silently paste nothing because a rule was too aggressive.

## Goals / Non-Goals

### Goals

- A pure, serialisable `postprocess(text, options)` with honest `applied` rule ids.
- Conservative rules with false-positive tests for words that look like fillers or repeats.
- A local word list that corrects a user's spellings and protects proper nouns.
- Per-rule switches and a safety guard that survives every rule firing at once.

### Non-Goals

- LLM cleanup, cloud calls, or prompt-based rewriting.
- A vocabulary editing UI; the file is hand-edited until the settings card lands.
- Punctuation/casing restoration beyond terminal punctuation normalisation, spoken lists,
  number/date normalisation, or paragraphing. Those remain later rule work.
- Chinese word segmentation; rules operate on characters, tokens, and explicit separators.

## Decisions

### 1. One pure core module, wired by the session

`src/core/postprocess/` exposes `postprocess`; `SessionController` accepts an optional
`postprocess` dependency and calls it after a successful provider result, before
`sendTranscript` and `paste`. The main process composes the dependency with options loaded
from `userData/vocabulary.json`.

- **Why**: this is the only insertion point shared by the fake and local providers. Injecting
  the function keeps the session testable without reading files.
- **Alternatives**: (a) call the stage inside each provider — rejected because it duplicates
  behavior and crosses the ADR-0003 boundary; (b) post-process in the renderer — rejected
  because pasting happens in main and the renderer must not gain transcript-editing authority.
- **Consequences**: provider latency measurements are unchanged; the stage's cost is not
  separately reported yet (the documented budget is ≤150 ms p95 and the rules are linear).

### 2. Mask protected and code-like spans before any rule

Protect entries and detected code-like tokens are replaced with private-use placeholders, all
rules run on the masked text, and the originals are restored in reverse mask order.

- **Why**: NFKC, punctuation conversion, and repetition collapse are exactly the rules most
  likely to damage `v1.2.3`, `foo_bar`, a URL, or a user's product name. Masking before NFKC is
  the only way to satisfy "protect is never modified by any rule".
- **Alternatives**: (a) skip whole tokens during each rule — rejected because every rule would
  need its own parsing; (b) trust word-boundary heuristics — rejected for CJK and punctuation.
- **Consequences**: over-matching code is safe (it only prevents edits); a transcript that
  happens to contain private-use characters is not supported, which is acceptable for speech
  text.

### 3. Order: vocabulary, normalise, self-correct, filler, repetition

Vocabulary replacement runs first, then code masking, NFKC and punctuation/spacing, correction
fragment removal, filler removal, and repetition collapse. Each step records its id only when
the text actually changed.

- **Why**: a user spelling is the authority and may itself create text the rules should see;
  corrections must remove a filler inside the abandoned fragment rather than leave it behind;
  repetition runs last so it sees the cleaned token stream.
- **Consequences**: a disabled earlier rule simply skips; later rules still run.

### 4. Dominant script counts Han characters against Latin runs

Chinese-dominant means `Han count >= Latin word-run count`; otherwise Latin-dominant. For
Chinese, ASCII punctuation becomes full-width only when it touches a Han character, and a full
stop additionally needs Han on its left. For Latin, CJK punctuation always becomes ASCII.

- **Why**: counting Latin characters lets one identifier (`Kubernetes`) flip a Chinese sentence
  to Latin and turn its final `。` into `.`. Counting runs keeps `用Kubernetes部署。` Chinese.
  The left-Han rule for `.` keeps `e.g.` followed by Chinese from becoming `e.g。`.
- **Alternatives**: detect the language per sentence or by Unicode blocks — rejected as more
  complex with no benefit for short dictation.
- **Consequences**: an English sentence embedded in Chinese may keep ASCII punctuation when the
  Han count is higher; that is a stylistic, not meaning-changing, difference.

### 5. Ambiguous fillers require punctuation, not just whitespace

`um`, `uh`, and `er` are removed whenever they stand as a token. `like` and `you know` are
removed only when punctuation (or the start/end of the text) sets them off.

- **Why**: `I like it` and `Do you know what I mean?` are ordinary prose; a whitespace-only
  rule would corrupt them. The documented false-positive test treats `like` as a verb.
- **Alternatives**: remove every standalone `like` — rejected; the documented precision target
  is ≥0.95 and false removals count against it.
- **Consequences**: `it's like really good` keeps `like`; that is a deliberate recall loss.

### 6. Repetition has keep lists and a threshold

The default threshold is 2; `repetitionThreshold` accepts 2–10. Latin token doubles in
`had had`/`that that` and Chinese AA reduplications in a curated set (`谢谢`, `妈妈`, `慢慢`)
are preserved, as are laughter characters. A three-dot ellipsis is not collapsed.

- **Why**: Chinese reduplication is grammatical, and deleting `谢` from `谢谢` changes a word.
  The card explicitly requires `我我我` to collapse but never a filler inside a real word.
- **Consequences**: a legitimate two-character word outside the keep set would be collapsed;
  the set covers the common cases and is a maintenance cost acknowledged by the docs.

### 7. Corrections restart the clause, not the whole utterance

A marker must be set off by punctuation or start the text and be followed by content. The
abandoned fragment is the clause before the marker; a run of markers (`不对，我是说C`) is one
correction. Earlier clauses survive.

- **Why**: `先做A，然后B，不对，我是说C` should become `先做A，C`; deleting from the start would
  lose information the speaker did not abandon.
- **Consequences**: `send it Monday, no wait, Tuesday` becomes `Tuesday`, not `send it
  Tuesday`; distinguishing the object from the verb phrase needs a parser, which is out of
  scope for a rule baseline.

### 8. Vocabulary lives in `userData/vocabulary.json`

`VocabularyStore` mirrors `ThemeStore`: async `load`/`save`, `ENOENT` silent, corrupt or
non-object JSON resolves to defaults, and the parser drops unknown keys and wrong types. The
file accepts `replace` as an array of `{ from, to }` or as a `{ wrong: right }` map.

- **Why**: consistent with the existing preferences pattern and editable without a UI. The card
  explicitly keeps vocabulary out of `preferences.json`.
- **Consequences**: edits apply on the next launch until the settings card adds a reload path.

### 9. Empty-output guard at both layers

Core returns the original text and an empty `applied` list when a non-empty input would become
empty. The session independently falls back to the raw ASR text if an injected stage returns
empty. Whitespace-only input is returned unchanged.

- **Why**: filler-only utterances and an aggressive word list must never paste nothing. Two
  layers keep the contract true even if a future stage implementation forgets it.
- **Consequences**: a user who genuinely wants an empty paste cannot get it from this stage;
  that is the correct safety trade-off.

## Risks / Trade-offs

- **Over-aggressive repetition in Chinese** — mitigated by the keep set and threshold; new
  legitimate words are added as reports arrive.
- **Vocabulary word boundaries for CJK** — CJK replacements match literally, so a short entry
  can rewrite inside a longer word. Longest-match-first reduces the risk; the settings UI
  should warn on very short entries.
- **Filler recall for `like`/`you know`** — intentionally conservative; the benchmark in
  `docs/LLM-POSTPROCESSING.md` is the place to measure precision/recall before widening.
- **No LLM cleanup** — this change deliberately ships the offline baseline only.

## Migration Plan

- Additive: `TranscriptEvent.applied` is optional; existing renderers and payloads keep working.
- `vocabulary.json` is optional; its absence means default rules and no replacements.
- No data migration and no provider/model change. Rollback is reverting the branch.

## Open Questions

- Should the UI show which rules fired (ids) rather than a count? Count is the minimal signal
  now; the settings card can expand it.
- Should user edits start training the vocabulary automatically? Deferred with the LLM decision.
