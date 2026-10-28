## Why

A second review found three rule defects and two tests that did not pin their stated failure
modes:

- A leading filler consumed only one mark from a separator run, leaving debris: `um... hello`
  became `Hello` only after deleting one dot, and `No wait... Tuesday.` became `. Tuesday.`.
- The Han repetition threshold of 2 mangled productive Chinese reduplication: `默默无闻` became
  `默无闻`, `冉冉升起` became `冉升起`, and so on for every idiom outside the finite keep list.
- Mask restore matched any sentinel-shaped text, not only the placeholders the masker emitted;
  a user transcript containing a sentinel sequence could be rewritten and the fail-closed
  guard would see no sentinel.
- The numeric-replacement test contained no replaceable `1`, and the sentinel-leak test had no
  rule that would change the text, so neither could detect its named regression.

## What Changes

- Filler and self-correction removals consume the entire adjacent separator run (`.`, `!`, `?`,
  `，`, `。`, `…`, and their repeats), not one character.
- The Han repetition threshold defaults to 3, so any two-character Chinese reduplication
  survives; Latin word repeats still collapse at 2. The keep list remains only as a guard when
  a user lowers the threshold to 2.
- Mask restore is scoped to a deterministic per-call nonce that is absent from the input, so it
  rewrites only placeholders that call emitted. A sentinel-shaped user transcript fails closed.
- Rewrite the numeric-replacement test to include a plain `1` that must be replaced, and the
  sentinel test to include a filler that would otherwise change the text.
- Reconcile the spec: Purpose includes casing, the vocabulary requirement describes span
  exclusion rather than "masked before any rule", and the repetition/filler/correction/masking
  requirements carry the new behavior and scenarios.

## Capabilities

### Modified Capabilities

- `text-postprocess`: separator runs, Han reduplication, call-scoped mask restore, and the
  corresponding scenarios.

## Impact

- `src/core/postprocess/rules.ts`: separator-run consumption, `…` separators, Latin-vs-Han
  repetition thresholds, nonce-scoped mask restore.
- `src/core/postprocess/index.ts`, `types.ts`: default threshold 3 and its documentation.
- `tests/postprocess.test.ts`: separator, reduplication, nonce, guard, and regression tests.
- No dependency, provider, paste-policy, or safety-guard change.
