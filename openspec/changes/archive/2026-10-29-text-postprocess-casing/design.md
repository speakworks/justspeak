## Context

The rule stage masks protected and code-like spans, then removes fillers, corrections, and
repetitions. A leading removal takes the sentence-initial capital with it:
`You know, it is fine.` → `it is fine.`. The stage already owns punctuation and script
normalisation, so leaving a lowercase sentence start contradicts its purpose. The fix must not
reach into the rest of the text: mid-sentence filler removal must leave inner casing alone, and
a protected token or a literal must keep its own case.

## Goals / Non-Goals

### Goals

- Restore the capital of the first Latin letter after a leading drop.
- Report the change as a `casing` rule and allow the rule to be disabled.
- Prove the mirror case: no accidental capitalisation mid-sentence, no lowercasing, no edit to
  protected/code-like/CJK text.

### Non-Goals

- Full casing restoration after every sentence boundary, acronym correction, or title casing.
  Those need sentence detection and are not part of this defect.
- Lowercasing anything. The rule only ever uppercases one character.
- Changing the safety guard or the apply order of the other rules.

## Decisions

### 1. One first-letter rule, applied last

`restoreSentenceCase` skips whitespace and opening quotes/brackets, then examines exactly one
character. If it is a lowercase Latin letter outside a mask, it is uppercased; everything else
leaves the text alone.

- **Why**: the defect is the loss of the sentence's first capital. A single-character rule is
  total, cheap, and cannot disturb inner casing.
- **Alternatives**: (a) capitalise after every `.`/`!`/`?` — rejected because abbreviations and
  decimals would need more code-span detection and the defect does not require it; (b) reuse a
  casing library — rejected as a new dependency for one character; (c) lowercase then
  sentence-case the whole text — rejected because it would destroy acronyms and protected
  tokens.
- **Consequences**: a leading digit or CJK character suppresses the rule; that is intentional,
  because the rule cannot know which later word is sentence-initial.

### 2. Run on masked text, and skip a leading mask

Casing is the last rule before restore. The first significant character is a mask placeholder
when the sentence starts with a protected token, code span, URL, or other literal; in that case
the rule does nothing.

- **Why**: the user's case for a protected token is authoritative, and a code literal has no
  sentence case to restore.
- **Alternatives**: scan past the mask for the first unmasked letter — rejected because it would
  capitalise a word that is not actually the sentence start.

### 3. `casing` is an ordinary switchable rule

The id joins `POSTPROCESS_RULES`, so `rules.casing: false` disables it and `applied` lists it
only when the character changed.

- **Why**: matches the contract the other five rules already follow and makes the behavior
  testable in isolation.
- **Consequences**: an all-rules-off configuration leaves the raw case untouched.

## Risks / Trade-offs

- A transcript that intentionally starts lowercase (a code fragment, a chat-style message) will
  gain a capital. The stage already optimises for dictated prose, and `rules.casing` is the
  escape hatch.
- Capitalisation after a leading quote is applied to the quote's first letter, which is the
  desired behavior; unusual bracket styles are transparent only for the listed characters.

## Migration Plan

- Additive: the new rule id is optional in configuration (omitted means enabled), and the
  `applied` payload remains a string array.
- Rollback is disabling `casing` or reverting the branch.

## Open Questions

- Whether to extend casing to sentence boundaries inside one transcript; deferred until a
  benchmark shows the additional false positives are acceptable.
