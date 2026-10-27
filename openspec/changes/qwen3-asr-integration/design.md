## Context

See `proposal.md` for motivation and `specs/` for the behavioral contract. The M0 code has a single Electron main entry (`src/main/index.ts`), a renderer that only computes RMS from an AudioWorklet, a fake provider in `src/core/asr`, and clipboard paste code coupled to Electron. There is no test runner, no model/runtime management, and no real PCM leaves the renderer.

Constraints inherited from ADR-0001/0003 and the card:

- `src/core` stays free of Electron, DOM, and OS APIs.
- The renderer is sandboxed; the only bridge is the preload allowlist.
- ASR input is 16 kHz mono PCM16; provider-specific names never leak into renderer code.
- Local-first default; no silent fake/cloud fallback.
- No weights or binaries in git; `models/` is local and gitignored.
- Pinned runtime and model; SHA-256 is the model trust check.

## Goals / Non-Goals

### Goals

- A real, reproducible Qwen3 transcript path on the developer machine, defaulting the app to qwen3 while keeping fake mode deterministic.
- Testable seams: provider contract, PCM validation/bounding, session state machine, clipboard snapshot/restore, and renderer capture edges all run in plain Vitest without Electron, a microphone, or a model.
- Measured evidence for the M1 gates: stop→final, RTF, peak RSS, model size, cold start, hardware.

### Non-Goals

- Streaming/partial hypotheses, VAD/endpointing, chunking beyond the 120 s buffer, diarization, or translation.
- Persistent sidecar/server mode, settings UI, history, cloud providers, Windows, or model-selection UI.
- Bundling weights or the runtime binary in the repository or installer; packaging/signing is later.
- Playwright E2E; it is optional and skipped if it blocks the card.

## Decisions

### 1. CLI + temporary WAV, not a persistent sidecar

`Qwen3AsrProvider` (core) delegates audio I/O to an injected runner port; the main-process runner writes one temporary 16 kHz mono WAV per utterance and spawns `transcribe-cli -q -m <model> <wav>`, capturing stdout.

- **Why**: the pinned transcribe.cpp release ships a CLI; a persistent server protocol is not part of v0.1 and adds lifecycle, framing, and idle-kill complexity. One process per utterance bounds failure blast radius and matches the frozen CLI decision.
- **Alternatives**: (a) Node FFI/native addon to `libtranscribe.dylib` — rejected for ABI and build complexity; (b) persistent server with JSON framing — rejected as out of scope and untestable in the budget; (c) cloud — prohibited.
- **Consequences**: process spawn latency (~model load) is included in stop→final; measured in the benchmark. The model file is memory-mapped per call, so warm page cache matters; reported as cold vs warm.
- **Temporary-audio exception**: AUDIO-PIPELINE forbids retaining session audio on disk. M1 writes one bounded WAV per utterance into the OS temp directory and deletes it on success, non-zero exit, timeout, cancel, and spawn error (covered by runner tests). A process crash can leave an orphan until the OS temp cleaner removes it; this bounded exception is documented here and does not create history or a persistent audio store.

### 2. Pinned versions and trust

- Runtime: transcribe.cpp `v0.4.1` tag (commit `4d7c1ccefd39e5a9ea36cca5f8fefc6dcc14b99b`) built locally by `scripts/setup-asr.mjs` into the gitignored `models/runtime/`. The release publishes a macOS arm64 Metal library bundle (tarball SHA-256 `7369e36dc2a5fc5d52eee5766fa03ad22d3f533c8688bf1deccf3ffdc202ea24`) but contains libraries only; the CLI is built from the pinned tag. The trust anchor is the tagged commit, not the release tarball.
- Model: `handy-computer/Qwen3-ASR-0.6B-gguf` revision `7e7c69a577fa2725dfedbe34b5e999336e30a19b`, file `Qwen3-ASR-0.6B-Q8_0.gguf`, 850,423,456 bytes, Apache-2.0, pinned SHA-256 `f081b2d5e23bd669d92cc331d722a8a0681943b8e6f34b48996fd5c319b5acd8` in `resources/models.json`. The digest was computed from the downloaded pinned revision and is committed before the first app run; the downloader compares against it.
- The declared capability `languages` list is the product-supported subset (`zh`, `en`, `yue`, plus the product tag `mixed`), not the upstream 30-language set. `maxAudioMs` stays at the conservative 87-minute decoder limit and a test asserts the catalog and provider constant agree.
- **Why**: the ADR makes the signed app the trust root in production; today the embedded catalog plus a committed SHA is the practical equivalent. A remote-signed catalog is future hardening.
- **Alternatives**: download from an unpinned URL or verify only size — rejected; a checksum next to attacker-controlled data is not a trust root.

### 3. Model/runtime resolution and first-run download

`resolveAsrPaths()` (main) reads, in order: `JUSTSPEAK_TRANSCRIBE_CLI` / `JUSTSPEAK_QWEN3_MODEL`, then the default paths under the app's `models/`. On startup with qwen3 selected:

1. If runtime is missing → error with `pnpm setup:asr` instructions (build requires Xcode/cmake; not automated inside the app).
2. If the model is missing → auto-download from the catalog with progress in the existing status message, verify size + SHA-256, atomic `.part` → final rename.
3. If the model exists → re-verify its SHA-256 at startup before `prepare` (trust-on-first-install is not enough); a mismatch errors with the expected/actual digest and the `pnpm setup:asr` repair command.
4. If verification fails → delete the partial file and error; never retry with a different model.

**Why**: weights are 850 MB and excluded from git; the app must be usable after first run without a terminal, but building a C++ runtime on first launch is not acceptable UX. Auto-download only applies to data.

### 4. PCM contract and bounding

- Context: the renderer requests `new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' })` and the capture controller rejects any context whose `sampleRate` is not exactly 16000 before creating the worklet. This is AUDIO-PIPELINE's "request a 16 kHz AudioContext and let Chromium resample" path; it keeps the renderer as the resampling shell and keeps `src/core` free of a DSP resampler. The ADR's core-resampling statement remains the target for native capture adapters; this card records the renderer path as the M1 exception and guards it instead of silently producing a wrong-rate WAV.
- Batcher: a pure `PcmBatcher` in core accumulates Float32 worklet frames, clamps to Int16, and emits 320-sample (20 ms) batches with a sequence number and `capturedAtMs`; `flush()` emits the final short batch at stop.
- Preload: one method `sendPcmBatch({ sequence, capturedAtMs, samples })` on the narrow bridge.
- Main: validates the sender webContents id, sequence, timestamp, and sample count (reject > 4,800 samples = 300 ms), accepts only in `recording`, and appends to a 120 s bounded buffer (1,920,000 samples). A sequence gap is counted; overflow is an error, not truncation. Late batches after stop are counted and dropped.
- **Why**: the IPC contract must not grow unbounded; 20 ms batches match AUDIO-PIPELINE's recommendation and keep stop flush short, and the pure batcher makes accumulation/clamping/sequence behavior testable.
- **Alternatives**: resample in core with a new DSP module — deferred to the native-capture card; 64 ms batches — rejected (stop latency); per-frame IPC — rejected (chatty); shared memory — deferred.
- **M1 exception recorded, not self-ratified**: AUDIO-PIPELINE documents requesting a 16 kHz `AudioContext` and letting Chromium resample, which is the path used here. The change adds a fail-closed `sampleRate === 16000` guard and defers a core resampler plus its alias/intelligibility quality gate to the native-capture card. The ADR's core-resampling rule remains the target for native adapters; it is not claimed as implemented by the renderer adapter. A docs-change ticket for the ADR-0003 owner to ratify or reject this M1 exception is recorded in the run ledger.

### 5. Pure session and capture controllers

- `SessionController` (core/app-neutral): owns `AppState`, validates summaries, drives transcribe → paste, emits transcript/state events. Main injects provider, injector, clock, and sender callbacks.
- `CaptureController` (core, structural ports): owns start/stop/cancel state, `getUserMedia`, context/worklet creation, batch callback, and cleanup. The renderer injects browser adapters; tests inject fakes.
- `pasteTranscript` (core) with ports for snapshot/write/read/restore/clear/press/delay; `src/main/injection.ts` is the Electron/osascript adapter.
- **Why**: the M0 bugs (stop during acquisition, retry during start, addModule failure, post-ack stop) live in these lifecycles; they must be testable without a GUI. The controllers stay in core as pure state machines over ports, consistent with ADR-0001.
- **Alternatives**: mock Electron modules in Vitest — rejected (fragile, hides real lifecycle bugs); Playwright only — rejected as blocking and slow.

### 6. Provider selection and no fallback

- One provider is created at startup from `parseAsrMode`: unset/`qwen3` → `Qwen3AsrProvider`, `fake` → `FakeAsrProvider`, and any other value is a startup error naming the accepted values (it never silently becomes qwen3 or fake). There is no runtime provider switch.
- The session applies ADR-0003's retry policy: one retry with the same provider and audio for `TIMEOUT` or retryable `INFERENCE_FAILED`; non-retryable codes (`CANCELLED`, `AUDIO_TOO_LONG`, `MODEL_MISSING`, `MODEL_LOAD_FAILED`, `UNSUPPORTED_LANGUAGE`) fail immediately. Errors carry the taxonomy code and a user-readable repair message. Error is reachable from `idle` so startup failures and retries are visible.
- `TranscriptEvent.fake` reflects the selected provider, and `AppStatus.modelInfo` exposes name/license/source for a single UI line.
- **Why**: the product promise is local-first, and a silent fallback would hide a broken install and produce misleading transcripts.

### 7. Test harness

- Vitest 5 (matches the Vite 8 / electron-vite 6 pipeline), node environment, no globals; tests import `vitest` explicitly.
- `pnpm test` = `vitest run`. Test projects:
  - `tests/provider-contract.ts`: one parameterized ADR-0003 suite run against both adapters — fake, and Qwen3 with a scripted runner — covering capabilities honesty, `prepare`/`health`, successful result shape, empty/silence input, max-audio rejection, cancellation, `dispose`, and no raw throw across the boundary.
  - `tests/fake-provider.test.ts` and `tests/qwen3-provider.test.ts`: invoke the shared suite; Qwen3 adds timeout, runner error mapping, invalid shape, and late-result suppression.
  - `tests/wav.test.ts`: header and payload.
  - `tests/model-catalog.test.ts`: pinned catalog parses, wrong schema/digest rejected, and the catalog `maxAudioMs` agrees with the provider capability.
  - `tests/model-manager.test.ts`: size/SHA-256 verification, corrupt download deletion, atomic success.
  - `tests/cli-runner.test.ts`: golden stdout captured from the pinned CLI, exit-code mapping, timeout kill, cancel, temp cleanup.
  - `tests/pcm-batcher.test.ts`: 320-sample accumulation, clamping, sequence/timestamp, flush.
  - `tests/pcm-buffer.test.ts`: valid batches, oversized batch, overflow, late frames, sequence gaps, empty finish.
  - `tests/session-controller.test.ts`: happy path, stale stop, empty stop, invalid summary, capture failure, provider error, 16 kHz guard, error-from-idle retry, and retry-once recovery/exhaustion/non-retryable cases.
  - `tests/paste.test.ts`: snapshot/restore, user-copy wins, paste failure keeps transcript, empty clipboard, non-text items.
  - `tests/capture-controller.test.ts`: stop during getUserMedia, retry during start, addModule failure, wrong sample rate, post-ack stop, normal start/stop.
  - `tests/ipc-sender.test.ts`: sender-id allowlist helper rejects a foreign webContents.
  - `tests/real-cli.smoke.test.ts`: opt-in (`JUSTSPEAK_REAL_ASR=1`) real pinned CLI test for the committed fixture and real silence (`text: (empty)` → empty text).
- Keep fakes deterministic; no real sleeps (fake timers or immediate promises); no network; no model in the default run.
- **Why**: this is the smallest suite that covers every M1 contract and M0 edge named in the card, and it runs in seconds.

### 8. Benchmark

- `scripts/make-fixture.mjs` generates a 3.8 s Mandarin WAV with macOS `say` + `afconvert` into `bench/fixtures/` (synthetic TTS, documented; safe to commit).
- `scripts/bench-asr.ts` (run with `tsx`) drives the **real `Qwen3AsrProvider` + `TranscribeCliRunner`** with decoded fixture PCM, so the measured stop→final is the actual provider path (validation, WAV encoding, temp file write, CLI spawn, parse), not a direct CLI call. It records provider latency, end-to-end CLI wall time, RTF (`inference_s / audio_s`), cold start (first call), warm median, peak RSS via a separate `/usr/bin/time -l` run, model size, CER against the fixture text (TTS smoke only, not accuracy evidence), and hardware/macOS.
- Peak RSS is measured by a separate `/usr/bin/time -l` invocation of the same pinned CLI and model because the provider owns the child process; the report labels that provenance.
- Output: `bench/results/<date>-<commit>.json` plus `bench/reports/2026-10-27-qwen3-asr.md`.
- **Why**: a measured baseline now prevents locking the model on estimates; the schema follows TESTING-STRATEGY and labels the RTF convention explicitly. Driving the provider keeps the harness honest and catches adapter overhead.

## Risks / Trade-offs

- **CLI cold start dominates short utterances** → measure and report cold vs warm; keep the provider contract final-only; persistent sidecar is a later optimization.
- **850 MB download / disk** → pinned size+hash, atomic `.part` cleanup on failure, manual deletion by removing `models/qwen3-asr-0.6b/`; resume is deferred past M1 and the next run restarts the download. The setup script can also reuse a local file.
- **Model download blocked without VPN** → `scripts/setup-asr.mjs` supports `HF_ENDPOINT` and a local `--model-file`; the run records the Astrill exit IP used for the download.
- **IPC TypedArray cloning overhead** → 20 ms batches (~640 bytes) and transferable buffers; measure only if capture jitter appears.
- **Long utterances exceed 120 s** → typed error and no silent truncation; chunking is a later card.
- **Accessibility denied breaks paste** → transcript stays on the clipboard with an actionable message; already M0 behavior, now tested.
- **Chromium's renderer resampling quality is unmeasured** → the 16 kHz context path is the documented AUDIO-PIPELINE option and fails closed on a wrong rate; a resampler alias/intelligibility gate is deferred to the native-capture card and recorded as a residual risk.
- **CLI silence sentinel** → the pinned CLI prints `text: (empty)`; the parser maps it to an empty transcript so the provider never surfaces invented text (verified by the opt-in real-CLI smoke).
- **Test/production drift** → one shared contract suite applies to fake and Qwen3 adapters; real-model smoke and benchmark run the same provider interface.

## Migration Plan

1. Land the harness and pure controllers with fake-provider tests (no model needed).
2. Add the PCM path and WAV assembly; keep `JUSTSPEAK_ASR=fake` green.
3. Add the model catalog, downloader, and Qwen3 adapter; run the local smoke against the pinned model.
4. Switch the default to qwen3; verify fake mode and the benchmark.
5. Rollback: `JUSTSPEAK_ASR=fake` restores the M0 provider path (qwen3 remains the unset default); no data migration or settings exist.

## Open Questions

- Whether the production installer should bundle the runtime binary and model, and how the signed catalog is distributed (v0.2 packaging).
- Whether a warm persistent sidecar is needed after benchmarking p95 on 10 s utterances (decision deferred to the benchmark).
- Exact VAD/endpointing ownership once streaming/partials arrive (out of scope here).
