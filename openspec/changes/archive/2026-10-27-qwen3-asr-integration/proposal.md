## Why

The M0 walking skeleton only returns a scripted fake transcript: the renderer sends no audio, and the app has no real ASR provider, no model management, and no automated test suite. M1 must prove the local-first vertical slice — real 16 kHz PCM from the renderer, a real Qwen3-ASR 0.6B Q8_0 transcript through the pinned transcribe.cpp CLI, and a deterministic contract test suite — before the model/quantization decision is benchmarked and locked. Silent fallback to fake or cloud would violate the local-first privacy default, so a missing model must surface an actionable error instead.

## What Changes

- Add `Qwen3AsrProvider`, an ADR-0003 `AsrProvider` adapter around a pinned `transcribe.cpp` v0.4.1 CLI and `Qwen3-ASR-0.6B-Q8_0.gguf` (850,423,456 bytes, Apache-2.0). It writes a temporary 16 kHz mono WAV per utterance, parses the CLI transcript, and returns `ProviderResult<TranscriptionResult>` with the shared error taxonomy.
- Add a pinned model/runtime manager: first-run download with SHA-256 verification, source URL and license metadata, atomic `.part` → final rename, `models/` gitignored, and no weights in git. A setup script builds the pinned runtime from source and fetches the model for development.
- Replace the RMS-only worklet with a real PCM path: AudioWorklet posts Float32 quanta, a pure `PcmBatcher` clamps and converts them to 16 kHz mono Int16 20 ms batches, and the narrow preload bridge carries only those bounded batches; main validates each batch, bounds the session at 120 s, assembles a WAV, and ignores late frames after stop.
- Extract the main-process session logic and renderer capture lifecycle into pure, injectable controllers so stop-during-getUserMedia, retry-during-start, addModule failure, and post-ack stop are unit-testable without Electron.
- Make `JUSTSPEAK_ASR=qwen3` the app default and keep `JUSTSPEAK_ASR=fake` for tests and the walking skeleton. When qwen3 is selected, a missing runtime/model is a visible error — never a silent switch to fake or cloud.
- Add Vitest and `pnpm test` covering the ADR-0003 fake-provider contract, IPC payload validation and session state machine, clipboard snapshot/restore and paste-failure behavior, and the M0 capture lifecycle edges.
- Add a reproducible benchmark: a committed 3–5 s synthetic WAV fixture, a script that measures stop→final, RTF, peak RSS, model size, cold start, and hardware, and a checked-in report plus JSON result.
- Preserve the existing single-card UI; show only the selected model's name, license, and source, with no settings, history, or cloud work.

## Capabilities

### New Capabilities

- `asr-provider`: ADR-0003 provider behavior for the fake and Qwen3 adapters, typed errors, model trust and download, and the no-silent-fallback rule.
- `audio-capture`: renderer PCM batching, bounded IPC payloads, session buffer limits, WAV assembly, and capture lifecycle edges.
- `dictation-session`: main-process session state machine, IPC validation, transcript events, clipboard snapshot/restore, and failure handling.

### Modified Capabilities

- None.

## Impact

- `src/core/asr`: provider types are reused; add `qwen3-provider`, WAV encoding, and model catalog helpers.
- `src/main`: composition root selects fake or qwen3, owns model/runtime resolution, download/verification, PCM accumulation, WAV writing, and sidecar process supervision.
- `src/preload` and `src/shared/ipc`: add a bounded `capture:pcm` message and model info to the status payload; keep the surface narrow.
- `src/renderer/src`: AudioWorklet posts Float32 quanta; the pure `PcmBatcher` clamps/converts them to Int16 20 ms batches; capture lifecycle moves into an injectable controller; UI gains one model/license/source line only (qwen3 mode).
- `tests/`, `vitest.config.ts`, `package.json`: Vitest harness and `pnpm test`.
- `scripts/`, `bench/`: setup and benchmark tooling; `models/` stays gitignored and contains no committed weights.
- OpenSpec: new change `qwen3-asr-integration`; archived into `openspec/specs/` at the end of the run.
