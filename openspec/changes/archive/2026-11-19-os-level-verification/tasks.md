# os-level-verification Tasks

## 1. OpenSpec

- [x] 1.1 `proposal.md` records why the real-machine gap exists and what is
      explicitly out of scope (no `src/` change, no CI wiring)
- [x] 1.2 `specs/real-machine-verification/spec.md` defines opt-in, the three
      AX cases, the two keyboard cases, and the honest-recording rule
- [x] 1.3 Tasks mark the real run as pending rather than done

## 2. Harness

- [x] 2.1 `tests/e2e/undo-real-ax.spec.ts`: three cases behind
      `JUSTSPEAK_REAL_AX=1`, whole file skipped when unset
- [x] 2.2 `tests/e2e/hotkey-real-keys.spec.ts`: two cases behind
      `JUSTSPEAK_REAL_KEYS=1`, dedicated instance for `Cmd+Q`
- [x] 2.3 Each file documents in its header how to run it, what it expects, and
      which system grants it needs

## 3. Evidence

- [x] 3.1 `docs/REAL-MACHINE-CHECKS.md` records the blocked reasons and the
      exact follow-up commands
- [ ] 3.2 **PENDING — not run.** `JUSTSPEAK_REAL_AX=1 npx playwright test
      tests/e2e/undo-real-ax.spec.ts` must pass 3/3 on a machine with a working
      GUI session. Blocked: the session that produced this change runs in the
      launchd Background domain and the screen was locked.
- [ ] 3.3 **PENDING — not run.** `JUSTSPEAK_REAL_KEYS=1 npx playwright test
      tests/e2e/hotkey-real-keys.spec.ts` must pass 2/2 under the same
      conditions. Same blocker.
- [ ] 3.4 **PENDING — not run.** The two documented limits (caret assumed at the
      end of the inserted text; bundle comparison skipped when the bundle id is
      empty) can only be re-assessed once 3.2 has run against real apps.

## 4. Flake investigation

- [x] 4.1 Full local E2E runs repeated to characterise the intermittent failure
- [x] 4.2 Failure class identified as test-side, with the evidence recorded in
      `docs/REAL-MACHINE-CHECKS.md`
- [x] 4.3 Fix applied under `tests/` only; `src/` untouched
