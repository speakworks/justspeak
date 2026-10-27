## 1. Test harness and dependencies

- [x] 1.1 Add Vitest 5.0.5 to devDependencies, create `vitest.config.ts`, add the `test` script to `package.json`, and verify `pnpm install` and an empty `pnpm test` run succeed.
- [x] 1.2 Extend `tsconfig.node.json` to include `tests/**/*.ts` and verify `pnpm typecheck` covers test files.
- [x] 1.3 Add `scripts/setup-asr.mjs` to build pinned transcribe.cpp v0.4.1 into gitignored `models/runtime/` and download/verify the pinned Qwen3 model; verify `node scripts/setup-asr.mjs --check` reports both artifacts ready.

## 2. Core ASR contract

- [x] 2.1 Add a WAV encoder for 16 kHz mono PCM16 and verify header/payload tests pass.
- [x] 2.2 Implement `Qwen3AsrProvider` over an injected runner port with ADR-0003 error mapping, timeout/cancel, and audio-shape validation; verify unit tests cover success, missing model, inference failure, timeout, cancel, and oversized audio.
- [x] 2.3 Add one parameterized ADR-0003 contract suite and run it against both adapters (fake, and Qwen3 with a scripted runner); verify capabilities honesty, result shape, empty input, health, max-audio rejection, cancellation, and no-throw behavior.
- [x] 2.4 Commit the pinned model SHA-256/size and runtime tag/commit in `resources/models.json`; verify tests reject a wrong schema, size, or digest, accept the pinned values, and keep `maxAudioMs` aligned with the provider capability.

## 3. Main-process runner, model manager, provider selection

- [x] 3.1 Implement the CLI output parser against a golden stdout captured from the pinned CLI and a subprocess runner (temporary WAV, `-q -m`, abort/timeout kill, cleanup); verify parser and runner tests pass with an injected fake child process.
- [x] 3.2 Implement first-run model download with streaming SHA-256, atomic rename, corruption rejection, interrupted-download cleanup, and progress callback; verify tests with an injected fetch stream pass.
- [x] 3.3 Wire `resolveAsrPaths` and startup provider selection via `parseAsrMode`: default `qwen3`, `JUSTSPEAK_ASR=fake` opts into fake, unknown values are an explicit error, and missing runtime/model produces a typed error with source/license/repair text; verify unit tests cover all modes and the no-fallback error.

## 4. Real PCM path

- [x] 4.1 Add shared `PcmBatch` payload types and a preload `sendPcmBatch` method; verify the preload surface test/typecheck shows only the allowed methods.
- [x] 4.2 Replace the RMS-only worklet with Float32 frames plus a pure Int16 `PcmBatcher` (320-sample accumulation, clamping, sequence/timestamp, stop flush), enforce a 16 kHz context in the capture controller, and verify capture-controller tests cover stop-during-getUserMedia, retry-during-start, addModule failure, wrong sample rate, post-ack stop, and normal start/stop.
- [x] 4.3 Implement main-side PCM validation, a trusted-sender check, and a 120 s bounded buffer with sequence tracking; verify tests cover valid batches, oversized batches, untrusted senders, overflow, late frames, sequence gaps, and empty finish.
- [x] 4.4 Assemble the WAV at stop and feed the selected provider; verify an integration test drives fake PCM batches through the session to a fake provider and observes one transcript.

## 5. Session state machine and injection

- [x] 5.1 Extract `SessionController` from `src/main/index.ts` with injected provider/injector/senders; verify happy path, stale stop, invalid summary, capture failure, provider error, wrong sample rate, and error-from-idle retry tests pass.
- [x] 5.2 Extract pure clipboard paste logic with ports for snapshot/write/read/restore/clear/press/delay and keep the Electron adapter; verify tests cover restore, user-copy-wins, paste failure keeping the transcript, and empty-clipboard clearing.
- [x] 5.3 Rewire `src/main/index.ts` and the renderer to the controllers, keep the existing UI, and show the selected model name/license/source line; verify `pnpm build` and a fake-mode launch smoke.
- [x] 5.4 Implement ADR-0003's same-provider retry-once for `TIMEOUT`/retryable `INFERENCE_FAILED` and no retry for non-retryable codes; verify recovery, exhaustion, and non-retryable tests pass.

## 6. Benchmark and documentation

- [x] 6.1 Generate and commit a 3–5 s synthetic Mandarin WAV fixture with manifest metadata; verify duration/sample rate/channels and SHA-256 are recorded.
- [x] 6.2 Implement the provider-driven benchmark script (real `Qwen3AsrProvider` + CLI runner) recording provider stop→final, RTF, peak RSS, model size, cold start, warm median, fixture CER, and hardware; verify it writes JSON and a markdown report from three real runs.
- [x] 6.3 Update the README with setup, fake-mode test, provider selection, benchmark, and model/license commands; verify commands match package scripts.

## 7. Verification and delivery

- [x] 7.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `openspec validate qwen3-asr-integration --strict`; verify all pass and record command summaries.
- [x] 7.2 Run `JUSTSPEAK_REAL_ASR=1 pnpm test tests/real-cli.smoke.test.ts` and confirm non-empty Chinese text for the fixture plus empty text for real silence; record evidence.
- [x] 7.3 Verify `git check-ignore models/qwen3-asr-0.6b/Qwen3-ASR-0.6B-Q8_0.gguf` exits 0 and no weights/binaries are staged before committing.
- [x] 7.4 Archive the OpenSpec change, commit on `feat/qwen3-asr`, push, and open a PR without merging; verify the archive diff, PR URL, and clean working tree.
