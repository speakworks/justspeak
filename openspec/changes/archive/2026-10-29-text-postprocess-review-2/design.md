## Context

The hardening pass closed mask-layer corruption and the broad casing trigger. Review then found
that the new separator handling consumed one mark instead of a run, that the Han repetition
threshold was too low for a productive reduplication class, and that mask restore still matched
sentinel-shaped user text. Two tests were also tautological for their stated regressions.

## Goals / Non-Goals

### Goals

- Remove entire separator runs adjacent to a removed filler or correction.
- Preserve any two-character Han reduplication at the default settings while still collapsing
  `我我我`.
- Scope mask restore to the placeholders a specific mask call emitted.
- Make the regression tests fail if the behavior they name regresses.

### Non-Goals

- Full ellipsis-aware punctuation restoration or sentence splitting.
- Segmenting Chinese to distinguish reduplication from stutter beyond the run-length rule.
- Changing the public config shape beyond the documented default.

## Decisions

### 1. Consume the separator run, not a mark

`separatorRunEnd` advances over every consecutive character in `SEPARATORS` (now including
`…`). Leading filler removal consumes the whole run plus following spaces; sentence-final
removal consumes the run and keeps at most the mark that already ended the previous sentence.
`applySelfCorrections` uses the same rule for the marker's trailing run.

- **Why**: `um... hello`, `um?? hello`, `嗯……我们走吧。`, and `No wait... Tuesday.` are one
  removal, not a single-mark edit. Anything less leaves debris.
- **Consequences**: a filler-only input such as `um...` becomes empty and the non-empty guard
  returns the original; that is the documented safety contract, not debris.

### 2. Han threshold 3, Latin threshold 2

`repetitionThreshold` is the Han-character threshold and defaults to 3. Latin word repeats
always collapse at 2. The keep list is reachable only when the user lowers the Han threshold to
2.

- **Why**: two-character reduplication is productive (默默, 冉冉, 匆匆, 津津, 欣欣, 彬彬, 滔滔),
  so a whitelist cannot cover it. Three-character runs are stutters. `the the` has no
  legitimate prose reading, so it stays at 2.
- **Alternatives**: keep threshold 2 and expand the whitelist — rejected as an unbounded
  maintenance burden that still mangles every unlisted idiom.
- **Consequences**: a legitimate three-character reduplication would collapse; such forms are
  rare and the keep set handles laughter/interjections.

### 3. Per-call, input-absent mask namespace

`maskSpans` derives a deterministic nonce from the text, the layer, and the span originals, then
salts it until the prefix is absent from the input. Placeholders are `start + nonce + '.' + id +
end`, and restore matches only that nonce.

- **Why**: the previous restore matched any `<id>` sentinel-shaped substring, so user text could
  be rewritten and no sentinel remained for the fail-closed guard to detect. The nonce keeps
  restore scoped to emitted placeholders and preserves determinism (it is derived only from the
  arguments).
- **Consequences**: the internal masked string is longer; output and `applied` are unchanged.
  A pathological input that contains every salted prefix causes extra salting, bounded by the
  input length.

## Risks / Trade-offs

- Lowering `repetitionThreshold` to 2 reintroduces the old reduplication risk; the keep list is
  the only guard there, and the config is user-controlled.
- Removing a whole ellipsis after a filler loses the pause nuance; the alternative is debris.
- The nonce is deterministic and input-derived, not cryptographic; it is collision avoidance,
  not a security boundary. The sentinel guard remains the backstop.

## Migration Plan

- Default behavior changes only for two-character Han runs (now preserved) and separator runs
  (fully removed). No config or IPC shape change.
- Rollback is reverting the branch or setting `repetitionThreshold: 2`.

## Open Questions

- Whether the threshold should be split into separate Han/Latin config keys; the current
  single key matches the existing `vocabulary.json` shape.
