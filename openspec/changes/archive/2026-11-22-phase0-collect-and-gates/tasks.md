# phase0-collect-and-gates Tasks

## 1. OpenSpec

- [x] 1.1 `proposal.md` states the collector, the endpoint measurement, the gate module, the shared SSE/TTS helpers and the non-goals
- [x] 1.2 `specs/phase0-collect/spec.md` states naming, grid shape, cell honesty, route asymmetry, endpoint and `--list` with scenarios
- [x] 1.3 `specs/degradation-gates/spec.md` states the six rules, the unknown-is-not-pass rule, the tri-state `allowL2`, the short-sentence requirement and the per-route echo rule
- [x] 1.4 `openspec validate --specs --strict` passes

## 2. Pure modules (`scripts/latency-harness/`)

- [x] 2.1 `collect.ts` — canonical name parsing, discovery with problems, 20 × 3 table, coverage, column pooling
- [x] 2.2 `endpoint.ts` — VAD walk that keeps the un-padded quiet-run start; blocked for a clip that ends mid-speech or holds no speech
- [x] 2.3 `sse.ts` — incremental `delta.content` parser that survives chunk splits
- [x] 2.4 `llm.ts` — first token and non-streaming timing over one parser
- [x] 2.5 `tts.ts` — Electron probe spawn plus `classifyTtsProbe`, partial-sample warning preserved
- [x] 2.6 `gates.ts` — six §f.3 rules, actions, tri-state `allowL2`, wording gate, Markdown section

## 3. Collector (`scripts/collect-phase0-latency.ts`)

- [x] 3.1 `--dir` / `--routes` / `--skip` / `--tts-samples` / `--llm-model` / `--list`
- [x] 3.2 Input-side measured once per recording, TTS once per route, stated in the artefact
- [x] 3.3 Writes `bench/results/phase0-collect-<date>-<commit>.json` and `bench/reports/<date>-phase0-latency.md`
- [x] 3.4 `pnpm bench:latency:collect` entry; version number untouched
- [x] 3.5 `--list` opens no model, sidecar or Electron process

## 4. Shared helpers

- [x] 4.1 `scripts/bench-speakpilot-latency.ts` uses `measureFirstToken` / `measureNonStreaming` / `probeTts` instead of its private copies
- [x] 4.2 No behaviour change to the existing harness segments or its artefacts

## 5. Tests

- [x] 5.1 `tests/latency-collect.test.ts` — names, gaps, duplicates, M1 refusal, 60-row grid, coverage, pooling
- [x] 5.2 `tests/degradation-gates.test.ts` — six rules at and across their thresholds, tri-state verdict, wording gate, rendering
- [x] 5.3 `tests/latency-endpoint.test.ts` — structural delay, hysteresis tail, two regions, clip ending mid-speech, silence, blip, override
- [x] 5.4 `tests/latency-sse.test.ts` — chunk split, multi-frame chunk, keep-alives, `[DONE]`, CRLF
- [x] 5.5 `pnpm test`, `tsc --noEmit` on both tsconfigs green

## 6. Docs

- [x] 6.1 `docs/PHASE0-RECORDING-PROTOCOL.md` — format, 20-recording split, three routes, machine-vs-human columns, fill rule, common errors
- [x] 6.2 `bench/fixtures/recordings/README.md` plus `.gitignore` entries: audio never committed

## 7. Real run on this machine

- [x] 7.1 `--list` run against the empty default folder: 0 recordings, 20 missing segments reported
- [x] 7.2 One-measurement run on a copy of `zh-4s.wav`: endpoint measured from the fixture, ASR / LLM / TTS recorded as `blocked` with their prerequisites, no estimated cell
- [x] 7.3 Generated artefacts removed afterwards: the numbers belong in the owner's next report, not in the repository
