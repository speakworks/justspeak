## Why

Phase 0 of `docs/SPEAKPILOT-CONVERSATION-PLAN.md` gate is explicit: **no measured table, no P1**, and estimates are not allowed as a substitute. Today there is no way to produce that table. The TTS figure in the plan (570–820 ms) came from a one-off manual probe that is not in the repository, so nobody can re-run it, and the ASR/LLM segments have no repeatable measurement path at all.

This change adds the machinery only. It measures three segments on this machine, writes them into a fixed shape, and refuses to record a number it did not observe.

## What Changes

- **Three independently runnable segments** behind one entry point, `scripts/bench-speakpilot-latency.ts` (`pnpm bench:latency`):
  - `asr` — the existing batch provider path on `bench/fixtures/zh-4s.wav`, wall clock including temp WAV write, CLI spawn, model load, inference and parse.
  - `llm` — first `delta.content` frame from the bundled `llama-server` over `stream:true`, plus one non-streaming reference number.
  - `tts` — first `utterance.onstart` from Chromium `speechSynthesis` in a hidden Electron window, 20 samples by default, with the first `boundary` callback recorded separately.
- **A blocked-path that cannot be mistaken for a pass.** A segment missing its runtime, model, audio voice or audio callback is recorded as `blocked` with the reason. It is never recorded as `0 ms`, and no segment ever falls back to an estimate.
- **Two guards against flattering numbers.** `voices=0` invalidates the TTS sample set, because the engine fired `onstart` without ever speaking (observed: `[478, 155, 1] ms`, which would have read as a 155 ms "P50"). A TTS P50 below 20 ms is likewise rejected as a silent no-op.
- **Fixed artefacts.** `bench/results/<date>-<commit>-<route>.json` (content-free: timings, sample counts, device name) and `bench/reports/<date>-speakpilot-latency-<route>.md` (readings, comparison against §f.1, mechanical reading of §f.3 rules). A 20 × 3 blank grid lands at `bench/reports/phase0-latency-template.md`.
- **Pure, tested arithmetic.** Percentiles and report assembly live in `scripts/latency-harness/` with no clock, filesystem or model access, so 23 unit tests run in CI on machines that could never measure anything.

## Non-goals

- No streaming ASR, no new TTS engine, no AEC work, no change to the dictation session, injection chain or settings surfaces.
- No auto-update of `docs/SPEAKPILOT-CONVERSATION-PLAN.md` §f.1; the owner backfills it after real recordings exist.
- No claim that any route was verified: the route label is declared by the operator and the harness only records the default output device name.
- No user-visible string claiming "实时对话"; the §f.3 rules keep that gated behind real measurements.
- Nothing here decides that the product passed. Gates report true / false / null; entering P1 stays a human decision.
