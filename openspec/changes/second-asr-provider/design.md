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

### 4. Silence gate

At the gate, 1 s of digital zeros produced `text: 그。` from the pinned SenseVoice build while Qwen3 returns empty text for the same input. Shipping that would paste a fake word.

`SenseVoiceAsrProvider` therefore computes RMS over the normalized Int16 PCM and, when it is below `SENSEVOICE_SILENCE_RMS_THRESHOLD = 0.002` (≈ -54 dBFS), returns `{ ok: true, text: '', warnings: [{ code: 'NO_SPEECH' }] }` without spawning the CLI. The threshold is a named constant with the rationale in code and is overridable per instance for tests:

- Speech RMS is typically -30 to -20 dBFS; quiet room tone is near -60 dBFS. -54 dBFS sits between them, so it only catches digital/near-silence and leaves quiet speech to the model.
- The comparison is strict (`rms < threshold` gates), so a sample exactly at the threshold runs inference; tests document both sides of the boundary (65/32768 gated, 66/32768 transcribes).
- The gate lives in the provider, not in callers: callers still receive the ordinary success result and the warning list, and the session/paste path is unchanged.

The shared `InferenceProvider` exposes a `beforeInference` hook, but only SenseVoice overrides it. Qwen3 keeps invoking its runtime, which already returns `(empty)`; its silence smoke still passes, so Qwen3's behaviour is unchanged.

### 5. Why not the card-20 VAD yet

Card 20's `src/core/audio/vad.ts` lives on an unmerged branch, so importing it here would couple this change to code that is neither reviewed nor available on `main`. A ~10-line RMS check is duplicated instead: the two checks answer the same question (is there speech?), the dependency is trivial, and this branch stays self-contained. Follow-up ticket: when card 20 lands, replace the local RMS gate with the shared VAD, keep the `NO_SPEECH` warning and empty result, and run the same silence fixtures across Qwen3 and SenseVoice. Until then, do not add the gate to Qwen3: its existing runtime path is already correct and must not change.

### 6. Selection and persistence

`resolveAsrMode` applies precedence: non-empty `JUSTSPEAK_ASR` (explicit override) → persisted `asr-preference.json` → `qwen3`. `parseAsrMode` accepts `qwen3`, `sensevoice`, and `fake`; `parseAsrPreference` rejects `fake` so a persisted value can never show demo transcripts as real ones. Unknown values fail visibly with the accepted list. The preference file is separate from `preferences.json` so a theme write cannot drop the provider.

### 7. UI reads capabilities

`AppStatus.modelInfo` carries the active provider's declared `AsrCapabilities`; `describeCapabilities` renders `非流式 · 单次最长 30 秒 · …`. The renderer iterates provider options and never maps a provider id to a capability value. The `FAKE ASR` badge remains a mode label, not a capability claim.

### 8. License and distribution

`docs/LICENSING.md` records the SenseVoice weights as the FunASR Model Open Source License v1.1, not MIT. The catalog stores `FunASR-Model-License-1.1`, the pinned Hugging Face revision, and the source URL; the base installer ships no weights, and the model is downloaded on first use with SHA-256 verification. `THIRD_PARTY_NOTICES.md` and counsel sign-off remain release prerequisites outside this change.

## Risks / Trade-offs

- **30 s window** → fixed-length dictation beyond 30 s fails visibly; chunking is out of scope and is not faked.
- **Silence gate false positives** → a genuinely quiet utterance below -54 dBFS is reported as empty instead of transcribed; the threshold is named, tunable, and documented, and the boundary is tested.
- **VAD convergence** → the local RMS check duplicates card 20's intent; see decision 5 and the follow-up ticket.
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
