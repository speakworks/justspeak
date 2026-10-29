## Context

The first implementation of the rule stage passed its original tests but failed review on real
inputs. Two mask layers shared one `<id>` sentinel namespace, so restoring the inner layer
rewrote the outer layer's placeholders and silently replaced protected text. Vocabulary ran
before masking, so it could match the digits inside a placeholder. Casing ran unconditionally
and capitalised lowercase prose and commands. Leading fillers left their sentence separator
behind, and the email regex was quadratic on long tokens.

## Goals / Non-Goals

### Goals

- Make protect and code masking provably non-interfering and fail closed on a leak.
- Make vocabulary unable to edit protected, code-like, or mask text.
- Make casing fire only after a rule removes the sentence's original first word.
- Remove orphan separators and keep long input linear.

### Non-Goals

- Redesigning the rule ordering or the paste/provider boundary.
- Adding a new dependency, parser, or segmentation model.
- Broadening casing to internal sentence boundaries.

## Decisions

### 1. Two sentinel namespaces, not one

`protect` uses `U+E000 … U+E001`; `code` uses `U+E002 … U+E003`. `maskSpans` takes a layer, and
each restore regex contains only its layer's pair. A namespace test masks two layers directly
and asserts that restoring one leaves the other's placeholder intact.

- **Why**: the collision is silent corruption; ordering alone does not make the encodings
  disjoint. Distinct start/end characters are provable by inspection and by test.
- **Consequences**: a final `containsSentinel` check returns the original input if any of the
  four characters survives restoration, so a future mask bug fails closed instead of emitting
  invisible characters.

### 2. Vocabulary outside protected and code-like spans

Vocabulary runs first (a user spelling is the authority), but it receives the merged protect and
code spans discovered on the original text and applies replacements only to the segments between
them. After replacement, the spans are re-detected before masking because offsets may have moved.

- **Why**: this simultaneously fixes the numeric-replacement/mask-encoding bug and makes the
  "masked first" invariant true for literals such as `` `cat` `` and URLs.
- **Alternatives**: masking first then vocabulary would still expose sentinel digits to a
  numeric replacement; post-hoc filtering would need a second parse.
- **Consequences**: a replacement may create a new code-like token; re-detection masks it before
  normalisation, so it is preserved from that point on.

### 3. Casing only after a leading removal

`applySelfCorrections` and `removeFillers` return `{ text, removedLeading }`. `removedLeading` is
true when the deletion starts at a leading position (whitespace and opening quotes are
transparent). Casing runs only when the flag is set.

- **Why**: the spec says casing restores the capital lost with the first word. Without the flag,
  `hello, world`, `her umbrella`, `concatenate the cat`, and `pnpm test` were capitalised.
- **Consequences**: a stutter at the start (`the the plan`) keeps lowercase because the first
  word survived; this is the correct reading of "removed the original first word".

### 4. Multi-word commands are literals

Bare `pnpm`/`npm`/`yarn`/`npx`/`bun`/`deno`, `git <subcommand>`, `cargo`/`docker`/`kubectl`/
`brew`, `go <subcommand>`, and `node`/`python` invocations are added to the code-span detector.
`um, pnpm test` therefore stays `pnpm test` instead of becoming `Pnpm test`.

### 5. Orphan separators are consumed with the filler

A leading filler consumes one following separator (comma or sentence mark). A sentence-final
filler either keeps the mark that already ended the previous sentence or keeps the mark that
terminates its own sentence, depending on which side the mark is on. Tests cover both.

### 6. Email pattern is anchored and bounded

The local part is preceded by a negative lookbehind for an email-local character and limited to
64 characters; the domain is limited to 255 and the TLD to 24. A 60,000-character token now
completes in milliseconds rather than seconds.

## Risks / Trade-offs

- The command pattern over-matches some prose ("npm is a package manager"); masking only
  prevents edits, so the cost is conservative, not corruption.
- Casing is now deliberately conservative; an intentionally lowercase dictation stays lowercase.
- A user text containing the private-use sentinels fails closed to the original; speech text
  never contains them.
- The fail-closed guard discards all rule work for that utterance, which is the safe choice.

## Migration Plan

- Additive: no config, IPC, provider, or paste change. The `casing` trigger change is observable
  but restores the spec's documented behavior.
- Rollback is reverting the branch or disabling `casing`/`vocabulary` in `vocabulary.json`.

## Open Questions

- Whether to add more command families to the literal detector; the current set covers the
  documented dictation and build workflows.
