# speakpilot-latency-harness Tasks

## 1. OpenSpec

- [x] 1.1 `proposal.md` states the three segments, the blocked-not-zero rule and the non-goals
- [x] 1.2 `specs/latency-harness/spec.md` states the segment, accounting, TTS-guard, artefact, grid and no-behaviour requirements with scenarios
- [x] 1.3 `openspec validate --specs --strict` passes

## 2. Pure arithmetic (`scripts/latency-harness/`)

- [x] 2.1 `stats.ts` — interpolated percentile, summary, threshold helper; empty sample yields `null`, not `0`
- [x] 2.2 `report.ts` — segment constructors that refuse a measured segment without samples and a blocked one without a reason
- [x] 2.3 `report.ts` — `classifyTtsProbe()` rejecting `voices=0` and sub-20 ms medians
- [x] 2.4 `report.ts` — gate evaluation from real samples only, `null` when unmeasured
- [x] 2.5 `report.ts` — Markdown report and the 20 × 3 blank Phase 0 grid

## 3. Segments (`scripts/bench-speakpilot-latency.ts`)

- [x] 3.1 `asr` — existing batch provider path on `zh-4s.wav`; blocked with the missing path when not installed
- [x] 3.2 `llm` — sidecar `stream:true` first-token measurement plus one non-streaming reference; `stream 未验证` when SSE is absent
- [x] 3.3 `tts` — Electron probe (`scripts/latency-harness/tts-probe.cjs`), 20 samples by default
- [x] 3.4 `--segments` / `--route` / `--tts-samples` / `--llm-model` / `--template-only` arguments
- [x] 3.5 `pnpm bench:latency` and `pnpm bench:latency:template` entries; version number untouched

## 4. Tests

- [x] 4.1 `tests/latency-harness.test.ts` — 23 tests over percentiles, summaries, constructors, gates, TTS guards, report rendering and the grid
- [x] 4.2 `vitest run tests/latency-harness.test.ts` green

## 5. Real run on this machine

- [x] 5.1 Run executed; all three segments recorded as `blocked` with reasons (ASR runtime not built, local gguf absent, `voices=0`)
- [x] 5.2 Rejected-sample case documented in `docs/SPEAKPILOT-LATENCY-HARNESS.md` so the guard is not mistaken for over-engineering

## 6. Docs

- [x] 6.1 `docs/SPEAKPILOT-LATENCY-HARNESS.md` — commands, prerequisites, artefacts, backfill steps, boundaries
- [ ] 6.2 §f.1 of `docs/SPEAKPILOT-CONVERSATION-PLAN.md` backfilled — blocked on the 20 real recordings, not on this change
