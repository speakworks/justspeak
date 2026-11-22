## Why

The Phase 0 gate says "no measured table, no P1". The table needs 20 recordings × 3 output routes. The harness added previously measures three segments on one fixture and writes a row for a single route: it proves the machinery works, but it cannot turn a folder of recordings into the grid. So the owner would still have to transcribe 60 rows by hand — which is exactly the step where a table quietly becomes estimates.

The same is true of §f.3: the six hard degradations are prose. Whether TTS must be swapped, automatic barge-in disabled, or a route forced to L1 is re-decided by whoever last read the document.

## What Changes

- **Collector** (`scripts/latency-harness/collect.ts`, `scripts/collect-phase0-latency.ts`, `pnpm bench:latency:collect`):
  - parses `rec-01.wav … rec-20.wav`, reports non-canonical names, out-of-range indices, duplicates and missing segments instead of dropping them silently;
  - measures the input-side segments (endpoint, ASR final, LLM first token) once per recording, applies the output-side segment (TTS first packet) once per route, and says so in the report instead of implying 60 independent measurements;
  - always renders the 20 × 3 grid: a cell is a number only when it was observed, otherwise `blocked`, otherwise `待填`;
  - writes `bench/results/phase0-collect-<date>-<commit>.json` and `bench/reports/<date>-phase0-latency.md`;
  - `--list` parses names and stops, so a collection session can be checked before spending time on measurement.
- **Offline endpoint measurement** (`scripts/latency-harness/endpoint.ts`): re-walks the live VAD window over a recording, keeps the un-padded quiet-run start that `detectSpeechRegions` discards, and reports the structural delay (hysteresis tail + `minSilenceMs`). A clip that ends while speech runs is `blocked`, because streaming would still be waiting.
- **§f.3 as code** (`scripts/latency-harness/gates.ts`): six rules, each returning `pass` / `fail` / `unknown` plus the action it implies; `allowL2` is tri-state and only `true` when every blocking rule was measured and passed; the "实时对话" wording is gated on that same value.
- **One SSE parser and one TTS probe**: `sse.ts`, `llm.ts` and `tts.ts` are shared by the existing harness and the collector, so "first token" and "first packet" have a single definition.
- **Protocol** (`docs/PHASE0-RECORDING-PROTOCOL.md`): audio format, the 20-recording split by what each one measures, why three routes are three runs of the same audio, what a script can and cannot measure, and the fill rule. `bench/fixtures/recordings/` is gitignored: it holds personal voice data.

## Non-goals

- No in-app recording, no new ASR runtime, no TTS engine change, no AEC work.
- No change under `src/` apart from reading the existing VAD; no version bump, no workflow change.
- No estimate ever fills a cell. A blocked column is part of the result, not a failure to hide.
- No automatic P1 entry: `allowL2` reports what the data permits; the human still decides.
- M1 stays a sum of P50s, labelled as arithmetic, until a listening check produces the calibrated value.
- M4 / M6 / M7 stay human-counted; the collector only accepts them when the owner supplies them.
