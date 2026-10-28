## Why

Dropping a sentence-initial filler also drops the capital that belonged to the sentence:
`postprocess('You know, it is fine.')` returns `it is fine.`. The rule stage is supposed to
handle casing (`docs/LLM-POSTPROCESSING.md` lists it in the rule stage), and a lowercase
sentence start is visibly worse than the untouched transcript. The same happens after a leading
self-correction (`I mean, tuesday.` → `tuesday.`).

## What Changes

- Add a sixth `casing` rule that runs last and uppercases only the first Latin letter of the
  result, so a dropped leading word gets its capital back.
- Skip the restoration when the sentence starts with Chinese/Japanese, a digit, or a protected
  or code-like token, because their case is not the rule's to change.
- Never touch anything after the first letter, so mid-sentence filler removal cannot capitalise
  the following word or lowercase existing text.
- Make `casing` individually disableable like the other rules and report it in `applied` only
  when it changes the text.

## Capabilities

### Modified Capabilities

- `text-postprocess`: adds the sentence-initial casing requirement and includes `casing` in the
  per-rule switch contract.

## Impact

- `src/core/postprocess/rules.ts`: `restoreSentenceCase`.
- `src/core/postprocess/index.ts`: casing step after repetition.
- `src/core/postprocess/types.ts`: new `casing` rule id.
- `tests/postprocess.test.ts`: required casing cases and updated expectations.
- No dependency, provider, paste-policy, or safety-guard change.
