## Why

The third review found two user-visible defects and a spec/test gap:

- Ellipses are corrupted: `他说……` and `他说...` become `他说。.` because normalisation
  converts the first dot of the run and repetition removes the rest. The spec claims a
  three-dot ellipsis survives, but no test covered it outside a filler removal.
- `repetitionThreshold: 2` is accepted by the config parser but clamped to 3, while the spec
  documents a reachable keep-list-at-2 behavior. The documented behavior cannot happen.
- The filler requirement says a sentence-final filler removes the "entire adjacent separator
  run", but `We go um...` deliberately keeps one mark, and the code agrees with the scenario,
  not the requirement.
- The `No side channels` axis had no test, and the dictation-session provider-failure scenario
  ("the stage does not run") had no test.

## What Changes

- Treat a punctuation run as an atomic token: mask runs of two or more marks and every
  ellipsis before NFKC, restore them before the filler pass, and never width-convert, split, or
  punctuation-collapse them. Only filler/self-correction removal may consume a run.
- Make the Han repetition threshold default to and floor at 3. A configured 2 is ignored by the
  parser and clamped by the stage; the keep list is retained only for a future lower floor.
  Remove the duplicate-punctuation collapse; runs are preserved.
- Reword the filler requirement to distinguish leading removal (whole run) from sentence-final
  removal (whole run, at most one mark kept when the filler followed a word).
- Add a source-surface purity test and a session test asserting the stage is not called after a
  provider failure.
- Remove any temporary probe scripts; probes run from `/tmp` or as inline `tsx -e`.

## Capabilities

### Modified Capabilities

- `text-postprocess`: atomic punctuation runs, the Han threshold floor, repetition without
  punctuation collapse, and the corrected filler wording.

## Impact

- `src/core/postprocess/rules.ts`: punctuation-run mask layer and finder; no punctuation
  collapse.
- `src/core/postprocess/index.ts`: punctuation mask before NFKC and restore before fillers.
- `src/core/postprocess/vocabulary.ts`, `types.ts`: threshold floor and docs.
- `tests/postprocess.test.ts`, `tests/preferences.test.ts`, `tests/session-controller.test.ts`:
  ellipsis, threshold, purity, and provider-failure tests.
- No dependency, provider, paste-policy, or safety-guard change.
