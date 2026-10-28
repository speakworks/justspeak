## Why

ADR-0003 promises a provider boundary that admits more than one local engine, but only the fake and Qwen3 adapters exist, and provider selection is a single environment variable. The boundary is unproven until a second real model runs through the same unchanged contract and a user can choose it.

The hard gate was run before any adapter code: the pinned `transcribe.cpp` v0.4.1 CLI loaded `SenseVoiceSmall-Q8_0.gguf` (252,684,608 bytes, SHA-256 `6c759ee4…59adf29`) and transcribed `samples/zh.wav` to `开放时间早上9点至下午5点。` with `detected-language: zh` on Metal. The runtime advertises `name: SenseVoice Small`, `license: FunASR-Model-License-1.1`, `max audio: 30.0 s`. The gate therefore passed, so this change implements the second adapter.

## What Changes

- Add `SenseVoiceAsrProvider` and extract the shared ADR-0003 behavior (`prepare`, validation, timeout, cancellation, result metadata) into `InferenceProvider`; `Qwen3AsrProvider` keeps its public class, constants, and behavior by extending it.
- Pin `SenseVoice Small Q8_0` in `resources/models.json`: revision `ff8f085a…`, 252,684,608 bytes, SHA-256 `6c759ee4…59adf29`, license `FunASR-Model-License-1.1`, first-run download only (no weights committed).
- Read the selected provider from a persisted preference (`asr-preference.json`), keep `JUSTSPEAK_ASR` as an explicit override, default to `qwen3`, and fail visibly on an unknown id. `fake` stays available only through the environment variable.
- Add a provider picker and a capability summary to the renderer. The summary is derived from `AsrCapabilities`, so a future adapter needs no renderer branch.
- Keep `streaming: false`, `timestamps: false`, `vad: false`, and `maxAudioMs: 30_000` for SenseVoice; audio above the window is rejected with `AUDIO_TOO_LONG` instead of being silently truncated.
- Extend the shared contract suite to the SenseVoice adapter and add tests for capability honesty, 30 s enforcement, unknown-id failure, preference round-trips, and fake/qwen3/sensevoice construction.

## Capabilities

### Modified Capabilities

- `asr-provider`: the provider contract now covers three adapters, preferences-based selection, and capability-driven UI rendering.

## Impact

- `src/core/asr`: new `InferenceProvider`, `SenseVoiceAsrProvider`, and `describeCapabilities`; `Qwen3AsrProvider` becomes a thin subclass with unchanged exports.
- `src/main/asr`: generalized CLI runner labels, per-provider paths, preference store, provider builder, and mode resolution.
- `src/main/index.ts` and `src/preload/index.ts`: minimal composition wiring for preference loading and the `asr:set-provider` bridge.
- `src/shared`, `src/renderer/src`: provider options, capabilities in `ModelInfo`, picker, capability summary.
- `resources/models.json`, `tests/`: pinned SenseVoice entry and new/updated suites.
- OpenSpec: this change; no weights or binaries are added to git.
