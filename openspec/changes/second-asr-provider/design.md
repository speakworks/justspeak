## Context

`asr-provider` already defines the ADR-0003 contract, typed errors, model trust, and the no-silent-fallback rule for the fake and Qwen3 adapters. This change adds the second real adapter the contract was meant to admit and moves selection from a single environment variable to a persisted user preference.

## Goals / Non-Goals

### Goals

- A second real provider that passes the unchanged `tests/provider-contract.ts` suite.
- A pinned catalog entry with source, license, size, and SHA-256; first-run download only.
- Explicit selection with a `qwen3` default, an environment override, and a visible failure for unknown ids.
- A UI that renders provider capabilities rather than branching on provider id.

### Non-Goals

- Streaming, VAD/endpointing, timestamps, chunking for audio over 30 s, or cross-provider fallback.
- Bundling weights, a model-manager UI, or changing the Qwen3 default.
- Re-licensing or relabeling the SenseVoice weights as MIT.

## Decisions

### 1. Gate result (evidence before code)

Commands run on 2026-10-29 from the repository root:

```bash
curl -L -o /tmp/jsm-gate-sensevoice/SenseVoiceSmall-Q8_0.gguf \
  https://huggingface.co/handy-computer/SenseVoiceSmall-gguf/resolve/ff8f085a8fa2e5ccae0e849ef19ebc6dc18e608b/SenseVoiceSmall-Q8_0.gguf
shasum -a 256 /tmp/jsm-gate-sensevoice/SenseVoiceSmall-Q8_0.gguf
./models/runtime/transcribe.cpp/build/bin/transcribe-cli \
  -m /tmp/jsm-gate-sensevoice/SenseVoiceSmall-Q8_0.gguf \
  models/runtime/transcribe.cpp/samples/zh.wav
```

Observed: digest matched the Hugging Face `x-linked-etag` (`6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29`), size 252,684,608 bytes; the CLI reported `model: … -> ok`, `backend: MTL0`, `name: SenseVoice Small`, `license: FunASR-Model-License-1.1`, `max audio: 30.0 s`, and `text: 开放时间早上9点至下午5点。` with `detected-language: zh`. An English JFK sample returned the expected sentence with `detected-language: en`.

The download required no VPN and used the public Hugging Face endpoint. No alternate model was substituted.

### 2. Shared adapter behavior, per-family capabilities

`InferenceProvider` owns validation, language hints, duration enforcement, timeout/cancellation races, and result metadata. A family adapter supplies only its id, capabilities, and runner. `Qwen3AsrProvider` keeps its current constructor and constants, so existing callers and tests are unchanged; `SenseVoiceAsrProvider` follows the same shape.

### 3. Honest capabilities

SenseVoice declares `languages: ['zh','yue','en','ja','ko']`, `streaming: false`, `punctuation: true` (ITN on by default produces casing, punctuation, and digits), `itn: true`, `timestamps: false`, `vad: false`, `maxAudioMs: 30_000`, and `quantizations: ['Q8_0']`. The runtime accepts longer audio with a warning and degraded accuracy; advertising that permissiveness as a capability would be dishonest. The provider rejects audio over 30 s with `AUDIO_TOO_LONG` before spawning the CLI.

Known limitation, observed at the gate: on 1 s of digital zeros the pinned SenseVoice build emits a short hallucinated token (`그。`) where Qwen3 returns empty text. This change does not claim silence robustness for SenseVoice; the library/design records it, and a core-side silence gate or VAD is follow-up work.

### 4. Selection and persistence

`resolveAsrMode` applies precedence: non-empty `JUSTSPEAK_ASR` (explicit override) → persisted `asr-preference.json` → `qwen3`. `parseAsrMode` accepts `qwen3`, `sensevoice`, and `fake`; `parseAsrPreference` rejects `fake` so a persisted value can never show demo transcripts as real ones. Unknown values fail visibly with the accepted list. The preference file is separate from `preferences.json` so a theme write cannot drop the provider.

### 5. UI reads capabilities

`AppStatus.modelInfo` carries the active provider's declared `AsrCapabilities`; `describeCapabilities` renders `非流式 · 单次最长 30 秒 · …`. The renderer iterates provider options and never maps a provider id to a capability value. The `FAKE ASR` badge remains a mode label, not a capability claim.

### 6. License and distribution

`docs/LICENSING.md` records the SenseVoice weights as the FunASR Model Open Source License v1.1, not MIT. The catalog stores `FunASR-Model-License-1.1`, the pinned Hugging Face revision, and the source URL; the base installer ships no weights, and the model is downloaded on first use with SHA-256 verification. `THIRD_PARTY_NOTICES.md` and counsel sign-off remain release prerequisites outside this change.

## Risks / Trade-offs

- **30 s window** → fixed-length dictation beyond 30 s fails visibly; chunking is out of scope and is not faked.
- **Silence hallucination** → see decision 3; the UI must not promise silence robustness that the model does not have.
- **No silent fallback** → a SenseVoice failure names the provider and keeps the audio/last transcript; it never retries on Qwen3.
- **Preference validation** → the store returns the raw string so an unknown id reaches `resolveAsrMode` and errors, rather than being coerced to the default.
- **Composition wiring** → `src/main/index.ts` and `src/preload/index.ts` receive minimal wiring (preference load + one IPC channel) even though the card's module list named only `src/main/asr/**`; no unrelated main/preload behavior changes.

## Migration Plan

1. Existing installs have no `asr-preference.json` → `qwen3`, unchanged behavior.
2. Selecting SenseVoice downloads the pinned 241 MiB Q8_0 file on first use and verifies it before loading.
3. Rollback: select `qwen3` or delete `asr-preference.json`; no data migration.

## Open Questions

- Whether a core silence/VAD gate should suppress the SenseVoice silence hallucination before the lightweight tier is offered as a default option.
- Whether chunking can extend SenseVoice past 30 s without hurting accuracy, and what the user-visible contract should be.
