## 1. Casing rule

- [x] 1.1 Add `restoreSentenceCase` to `src/core/postprocess/rules.ts`: skip whitespace and opening quotes/brackets, skip a leading mask or non-Latin character, uppercase only the first Latin letter.
- [x] 1.2 Add the `casing` rule id to `POSTPROCESS_RULES` and run the step last in `src/core/postprocess/index.ts`, recording it in `applied` only when it changes the text.
- [x] 1.3 Verify `rules.casing: false` disables it and the non-empty safety guard still returns the original input.

## 2. Tests

- [x] 2.1 Add table-driven cases: `You know, it is fine.` → `It is fine.`; `um, we should go` → `We should go`; `I mean, tuesday.` → `Tuesday.`; Chinese unchanged.
- [x] 2.2 Add the mirror cases: `I think, um, we should ship it.` and `We test, um, we ship.` keep inner casing; `I like it.` is untouched.
- [x] 2.3 Add protected-token, code-span, URL, disabled-rule, and `applied` assertions; update existing expectations that now start with a capital.
- [x] 2.4 Confirm `pnpm test` still proves the never-empty guard (`um` and filler-only input return the original).

## 3. Verification and delivery

- [x] 3.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `openspec validate --specs --strict`.
- [x] 3.2 Archive this change, commit on `feat/text-postprocess`, push, and update PR #6 without merging.
