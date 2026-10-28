## Why

Raw ASR text is pasted verbatim today: fillers ("嗯", "um"), stutters ("我我我"), abandoned
self-corrections ("周一发，不对，周二发"), and a user's own spelling corrections never get a
chance to run. `docs/LLM-POSTPROCESSING.md` accepts a rule-based baseline as the v0.1 default
because it is offline, deterministic, and privacy-preserving, but no such stage exists in the
pipeline. This change adds the deterministic baseline only; any LLM cleanup remains a separate,
network-and-cost decision for the product owner.

## What Changes

- Add a pure `src/core/postprocess/` module: `postprocess(text, options)` returns
  `{ text, applied }` with no Electron, DOM, filesystem, network, or clock access.
- Normalise Unicode with NFKC, collapse whitespace, remove stray spacing, convert punctuation
  to the text's dominant script, and leave code-like tokens untouched.
- Remove standalone Chinese and English fillers, collapse immediate repetitions beyond a
  configurable threshold, drop duplicated punctuation, and drop the abandoned fragment before
  explicit self-correction markers.
- Apply a local personal vocabulary — `replace` corrections and `protect` tokens — before
  normalisation, loaded from `userData/vocabulary.json`.
- Run the stage inside `SessionController` between the provider result and `paste`, so the fake
  and local providers share it, and record the rule ids on `TranscriptEvent.applied`.
- Make every rule individually disableable through the same JSON file, and guarantee that a
  non-empty transcript never becomes empty.

## Capabilities

### New Capabilities

- `text-postprocess`: the deterministic, pure cleanup stage, its rule ordering and safety
  properties, the personal vocabulary file, and per-rule switches.

### Modified Capabilities

- `dictation-session`: transcript delivery now carries the applied rule ids, and the session
  runs post-processing between a successful ASR result and the paste call.

## Impact

- `src/core/postprocess/`: new pure module (`types`, `vocabulary`, `rules`, `index`).
- `src/core/session/session-controller.ts`: new optional `postprocess` dependency and the
  raw-text fallback before paste.
- `src/main/`: `vocabulary-store.ts` mirrors `ThemeStore` for `userData/vocabulary.json`;
  `index.ts` loads the options at startup and wires the stage into every session.
- `src/shared/ipc.ts`: additive `applied?: string[]` on `TranscriptEvent`.
- `src/renderer/src/App.tsx`: shows how many rules cleaned the latest transcript.
- `tests/postprocess.test.ts`, `tests/preferences.test.ts`, `tests/session-controller.test.ts`:
  table-driven rule coverage, file-store failure modes, and the result→paste wiring.
- No new runtime dependency; no provider-contract or paste-policy change.
