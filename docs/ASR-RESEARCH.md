# ASR Strategy Research for JustSpeak v0.1

- Status: Pending benchmark (prior: Qwen3-ASR 0.6B through transcribe.cpp; final
  model/quantization lock pending)
- Date: 2026-10-26
- Decision owner: FD2008
- Scope: local, cloud, and hybrid automatic speech recognition (ASR) options for the
  v0.1 macOS desktop app. Research only; no code, dependencies, models, or benchmarks are
  included in this card.
- Depends on: [ADR-0001: Core boundary](ADR-0001-core-boundary.md),
  [ADR-0002: Technology stack](ADR-0002-tech-stack.md),
  [ARCHITECTURE.md](ARCHITECTURE.md)
- Evidence tags: **E2** = primary artifact inspected directly for this document (license
  API response, raw license file, model metadata, repository file). **E3** = public
  web/third-party or vendor documentation, or the author's reading of public docs that was
  not re-fetched for every claim. E3 claims must be re-checked before they become
  implementation facts. Access date: 2026-10-26.

## Requirements

The ASR layer must work inside the frozen desktop stack: Electron 45 + TypeScript +
React 19 + electron-vite 6 + a small Swift helper (ADR-0002), with `src/core` free of
Electron and OS imports (ADR-0001). Local inference runs in a sidecar process, not in the
Electron main process (ARCHITECTURE.md).

| ID | Requirement | Target or constraint | Source |
|---|---|---|---|
| R1 | Languages | Mandarin Chinese, English, and mixed Chinese/English utterances, including proper nouns and technical terms | Product scope |
| R2 | Final latency | p50 end-of-speech (or stop) to final text < 1.5 s; p95 ≤ 3 s for a 10 s utterance on Apple Silicon with the local provider | ARCHITECTURE.md latency targets; this card |
| R3 | Privacy | Local-first: audio processed on device by default; no vendor account required; cloud only after explicit opt-in and a data notice | ADR-0002, ARCHITECTURE.md |
| R4 | Cloud BYOK | Optional cloud provider with user-supplied API key, stored in Keychain/`safeStorage`, never exposed to the renderer | ADR-0002, ARCHITECTURE.md |
| R5 | Model size | Default model download target ≤ 1 GB; total installed models target ≤ 2 GB; models are not bundled in the base installer | ADR-0002 bundle concerns; proposed here |
| R6 | Offline | Local provider must work fully offline after the model is downloaded and verified | Product scope |
| R7 | Licenses | Code and model weights must permit commercial use in an MIT-licensed app; attribution obligations are acceptable; non-commercial weights are excluded | This card; verified in License Findings |
| R8 | Maintainability | Solo TypeScript developer: prebuilt binaries, stable process boundary, no Python runtime in the shipping app, active upstream, small integration surface | ADR-0002 |
| R9 | Platform | macOS arm64 first; Intel Mac if practical; Windows later without replacing the core interface | ADR-0002, ARCHITECTURE.md |
| R10 | No live partials | v0.1 returns a final transcript after the user stops; live partial hypotheses are not required. This matches the observed Typeless behavior and simplifies the provider interface | Frozen decision in this card; E3 Typeless notes |
| R11 | Runtime context | The ASR runtime must be launchable and supervizable from Electron main (sidecar or Swift helper), with no renderer access and no native ABI coupling to Electron | ADR-0002, ARCHITECTURE.md |

Non-goals for v0.1: streaming partial captions, speaker diarization, word-level timestamps
in the UI, translation, and on-device LLM polishing. Optional LLM polish is a separate
post-processing step and is out of scope for model selection here.

## Options

### Local candidates

#### Whisper family (OpenAI Whisper, whisper.cpp, WhisperKit)

**openai/whisper** is the reference PyTorch implementation. It is multilingual, robust to
noise and accents, and widely benchmarked, but it is a Python/Torch runtime and is not a
shipping runtime for an Electron app. Use it as a quality reference and for offline
experiments only.

**whisper.cpp** is a C/C++ implementation on the ggml stack with Metal and CoreML
acceleration on Apple platforms. It ships quantized models, a command-line binary, and
language bindings, so it can run as a sidecar process. Strengths: broad multilingual
coverage, mature ecosystem, MIT code, straightforward sidecar integration, and good
English accuracy. Weaknesses: autoregressive decoding makes latency grow with output
length; small models are weak on Chinese and mixed-language technical terms; medium and
large models are slower and larger; true streaming is limited compared with dedicated
streaming models.

**WhisperKit** is a Swift/CoreML Whisper runtime for Apple platforms. It can deliver the
best Whisper latency and memory behavior on Apple Silicon because it uses Core ML and the
Neural Engine. It fits the existing Swift helper shape, but it is macOS-only, adds a second
model-distribution path, and does not help the Windows-later path. It is a strong
macOS-only acceleration option, not the portable default.

#### Qwen3-ASR 0.6B (Alibaba Qwen)

Qwen3-ASR 0.6B is an audio-LLM model: an 18-layer bidirectional audio encoder feeds a
Qwen3 causal language model that emits the transcript autoregressively. It is the quality
default prior for v0.1 because it has the strongest Chinese and Cantonese results among the
local candidates in the same transcribe.cpp evaluation harness, and because its code and
weights are Apache-2.0. The official model covers 30 languages plus 22 Chinese dialects
(E3); the transcribe.cpp port advertises 30 languages with auto-detect (E2). Q8_0 is
about 850 MB, Q4_K_M about 590 MB, and the C++ port accepts up to roughly 87 minutes of
16 kHz mono audio per call.

Measured/ported evidence (transcribe.cpp, E2): FLEURS-zh CER 7.57%, FLEURS-yue CER 7.91%,
FLEURS-en WER 4.23% for Q8_0; Apple M4 Max Metal compute latency 147 ms for an 11 s sample
and 556 ms for a 35 s sample; CPU 545 ms and 2.06 s respectively. These are compute
latency, not end-to-end dictation latency, and they are not a substitute for the local
benchmark. The C++ port does not support streaming, VAD, timestamps, or speaker
diarization; v0.1 only needs final transcripts. The 0.6B model echoes vocabulary prompts
into the output more often than the 1.7B variant, so vocabulary biasing should be off by
default until measured.

License: Apache-2.0 for the code and official weights; third-party GGUF/OpenASR
conversions may carry different provenance and must be checked per artifact. The Apache-2.0
default is the cleanest licensing position among the local candidates.

#### SenseVoice (FunAudioLLM/SenseVoice)

SenseVoiceSmall is a non-autoregressive multilingual speech model (Chinese, English,
Cantonese, Japanese, Korean) with a small parameter count and fast inference. It is the
**lightweight tier**, not the default: transcribe.cpp Q8_0 is 253 MB (Q4_K_M 146 MB),
single-pass inference keeps tail latency low, and it fits 8 GB Macs. Its Chinese and
Chinese/English code-switching behavior is good, but below Qwen3-ASR 0.6B in the same
transcribe.cpp harness: FLEURS-zh CER 10.12%, FLEURS-yue 37.44%, FLEURS-en WER 7.14%
(E2, Q8_0). It has a 30-second input limit per segment and no word timestamps in the
common export. transcribe.cpp enables ITN by default, which produces casing, punctuation,
and digits; ITN costs a small English WER regression and improves Chinese digit
normalization. The official small model is roughly 234M parameters and a 936 MB PyTorch
checkpoint; the GGUF conversions above are much smaller.

License nuance: the repository code is MIT, but the official SenseVoiceSmall weights are
distributed under the FunASR Model Open Source License Agreement, not MIT. The official
clarification permits commercial use when the model license is followed, including
Section 2.2 attribution and model-name requirements. Third-party conversions may carry
different terms. See License Findings.

#### Paraformer / FunASR

Paraformer is FunASR's non-autoregressive Chinese ASR family, with separate Chinese and
English models. It is fast, well supported by sherpa-onnx, and a reasonable Chinese
baseline. It is less compelling than SenseVoice for mixed Chinese/English because the
models are typically language-specific, and FunASR itself is a Python toolkit that should
not ship in the desktop app. Use Paraformer as a benchmark baseline and as a possible
Chinese-only fallback; export or run it through sherpa-onnx.

#### NVIDIA Parakeet / NeMo

NeMo is NVIDIA's Apache-2.0 framework; Parakeet TDT 0.6B is a strong English model. The
Parakeet TDT 0.6B v2/v3 weights on Hugging Face are CC-BY-4.0, and the released `.nemo`
checkpoint is about 2.47 GB. Parakeet v3 targets European languages; it is not a Chinese
solution. Running NeMo in the product would require a Python runtime or an ONNX export
plus custom pre/post-processing. It is an English quality reference, not a v0.1 default.

#### Vosk

Vosk is Apache-2.0, small, offline, streaming, and available for many languages with Node
bindings. It is easy to embed and has a very small footprint. Accuracy, punctuation, and
mixed-language handling are below Whisper and SenseVoice; it is best treated as a
low-resource fallback or a latency baseline, not the primary dictation model.

#### Moonshine

Moonshine is a compact speech model family optimized for short utterances. The repository
code is MIT. The current license states that all streaming models and all English models
are MIT, while **legacy non-streaming models for languages other than English remain under
the non-commercial Moonshine Community License**. The Hugging Face card for
`moonshine-base-zh` reports `license: other`, consistent with that restriction. Moonshine
is therefore not a commercial Chinese option in v0.1. English-only use is possible but
does not satisfy R1.

#### Local runtime layer

| Runtime | License | Role | Notes |
|---|---|---|---|
| **transcribe.cpp** | MIT | **Selected runtime**; supports Qwen3-ASR, SenseVoice, Parakeet, Moonshine, Fun-ASR-Nano, and other GGUF models | C/C++/ggml with Metal/Vulkan/CUDA; one runtime covers the quality default, lightweight tier, and optional English pack; no VAD/punctuation pipeline; younger than sherpa-onnx |
| **sherpa-onnx** | Apache-2.0 | **Backup** multi-model runtime; supports SenseVoice, Paraformer, Whisper, and NeMo | C++/ONNX Runtime with prebuilt binaries and a Node addon; Qwen3-ASR support is not confirmed, so it cannot be the primary path |
| **whisper.cpp** | MIT | Whisper-only fallback | Mature; Metal/CoreML acceleration; simplest plan B if Whisper is needed |
| **onnxruntime-node** | MIT | Direct ONNX escape hatch | Maximum control but you own feature extraction, tokenizer, and decoding; highest integration cost |
| **WhisperKit** | MIT | Swift/CoreML Whisper path in the helper | Best Apple Silicon Whisper performance; macOS-only; a candidate only if the portable path misses R2 |

For a solo developer, `onnxruntime-node` is an escape hatch, not the default.
**transcribe.cpp is selected** because one runtime covers Qwen3-ASR, SenseVoice, and
optional Parakeet/Moonshine without a second sidecar; its Qwen3-ASR and SenseVoice ports
are pinned and WER-validated. `sherpa-onnx` remains the backup if transcribe.cpp is
unstable on Windows/Vulkan or if Paraformer/Zipformer streaming is needed later.
`whisper.cpp` is only for the Whisper fallback, not a second default path.

### Cloud candidates

Cloud ASR is optional and BYOK. It is attractive for quality headroom, not as the default,
because it contradicts local-first privacy and requires network access.

| Provider / model | Languages and strengths | Latency shape | Cost signal (E3) | Privacy / integration |
|---|---|---|---|---|
| **OpenAI** `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `whisper-1` | Strong multilingual and mixed-language quality; punctuation and formatting | Batch HTTP is the simple path; realtime transcription sessions exist but are not needed for v0.1 | Roughly $0.003–0.006/min published list price; verify current pricing | Audio leaves device; BYOK; simple HTTPS client |
| **Deepgram** Nova-3 | Strong English, low-latency streaming, good developer API | Designed for streaming; batch also supported | Roughly $0.008/min pay-as-you-go; committed tiers differ | Audio leaves device; BYOK; WebSocket/HTTP |
| **AssemblyAI** Universal | Strong English, solid multilingual, diarization and formatting features | Streaming and batch | Roughly $0.006/min; verify current list | Audio leaves device; BYOK; HTTP/WebSocket |
| **Qwen3 ASR Realtime** (Alibaba Cloud DashScope) | Strong Mandarin and Chinese/English code-switching; realtime API | Low latency in-region; cross-border latency and availability vary | Usage-based per-second pricing; verify DashScope region and billing | Audio leaves device; BYOK; endpoint/region matters |
| **Google / Azure / AWS** | Broad language coverage and enterprise compliance | Streaming and batch | Usage-based and tiered; typically higher than the specialist APIs | Service-account/key or SigV4 auth; heavier integration; data residency options |

Cost figures above are order-of-magnitude list prices and must be re-verified before they
appear in product copy. Cloud providers are commercial services, not open source; their
terms govern data handling, retention, and resale. JustSpeak should show a per-provider
data notice and never enable cloud silently.

### Hybrid strategy

Adopt a **local-first default with optional cloud BYOK**, behind one provider interface in
`src/core`:

- **Default:** local model. No network access after model download. No account.
- **Opt-in:** the user selects a cloud provider, enters an API key, and accepts a data
  notice. The key is stored in Keychain via the Swift helper or Electron `safeStorage`.
- **No silent failover:** if local inference fails or times out, the app keeps the audio,
  offers retry, and may switch to a provider the user explicitly configured. It must not
  send audio to a cloud provider that the user did not enable for that session.
- **Local fallback:** if the default local model fails on a language or term set, fall back
  to a second local model (for example Qwen3 → SenseVoice or Whisper) before suggesting
  cloud.
- **No live partials in v0.1:** the interface is final-only. A `streaming` capability flag
  exists for future providers, but the v0.1 UI shows recording → transcribing → done.

The canonical provider contract is [ADR-0003](ADR-0003-provider-boundaries.md): `prepare`,
`transcribe`, `dispose`, `health`, `ProviderResult<TranscriptionResult>`, `AbortSignal`
cancellation, and capability flags. Do not duplicate the interface here; ASR-RESEARCH is
the model/runtime rationale, not a second contract. The core owns VAD, endpointing, audio
normalization, and post-processing; providers own only inference and decode.

## Comparison

Scores are 1 (worst) to 5 (best) and are the author's judgment informed by public
documentation and the evidence below. They are **not measured benchmarks**; the benchmark
plan is how they get replaced with data. Latency and size are estimates for a 10 s
utterance on Apple Silicon unless marked E2.

### Local candidates

| Candidate (runtime) | Chinese | English | Mixed zh/en | Latency estimate | Model size on disk | Offline | Cost | License (code / weights) | Integration effort (Electron/TS) | Platform |
|---|---:|---:|---:|---|---|---|---|---|---|---|
| **Qwen3-ASR 0.6B** (transcribe.cpp, Q8_0) | 5 | 4–5 | 5 | ~0.15–0.6 s compute (M4 Max; 11–35 s samples) | 850 MB Q8_0; 590 MB Q4_K_M (E2) | Yes | Free | Apache-2.0 code / Apache-2.0 weights (E2/E3) | Medium (sidecar) | macOS, Windows, Linux |
| **SenseVoice Small** (transcribe.cpp, Q8_0) | 4 | 3 | 4 | ~0.3–0.8 s (non-autoregressive) | 253 MB Q8_0; 146 MB Q4_K_M (E2) | Yes | Free | MIT code / FunASR Model License (commercial with attribution; legal review) | Medium (sidecar) | macOS, Windows, Linux |
| **Whisper small** (whisper.cpp, Metal) | 3 | 4 | 3 | ~1–3 s | ~0.5 GB fp16-class | Yes | Free | MIT code / Apache-2.0 weights (E2) | Low–medium (sidecar CLI) | macOS, Windows, Linux |
| **Whisper medium** (whisper.cpp, Metal) | 4 | 5 | 4 | ~2–5 s | ~1.5 GB | Yes | Free | MIT / Apache-2.0 | Low–medium | macOS, Windows, Linux |
| **Whisper large-v3-turbo** (whisper.cpp) | 4 | 5 | 4 | ~1.5–4 s | ~1.6 GB | Yes | Free | MIT / Apache-2.0 | Low–medium | macOS, Windows, Linux |
| **WhisperKit** (CoreML, small/medium) | 3–4 | 4–5 | 3–4 | ~0.5–2 s | Similar to Whisper | Yes | Free | MIT | Medium–high (Swift helper) | macOS only |
| **Paraformer zh** (sherpa-onnx) | 4 | 2 | 3 | ~0.3–0.8 s | ~0.2 GB int8; ~0.8 GB fp32 (estimate) | Yes | Free | MIT code / model-specific license | Medium | macOS, Windows, Linux |
| **Parakeet TDT 0.6B** (NeMo/ONNX) | 1 | 5 | 1 | Fast on GPU; CPU rate to be measured | 2.47 GB `.nemo` (E2) | Yes | Free | Apache-2.0 code / CC-BY-4.0 weights (E2) | High (Python or ONNX export) | macOS (CPU/GPU), Linux |
| **Vosk small** (Vosk) | 2 | 2 | 1 | Fast | ~40–50 MB | Yes | Free | Apache-2.0 | Low (Node binding) | macOS, Windows, Linux |
| **Moonshine** (ONNX/ggml) | 1–2 | 3–4 | 1 | Fast for short clips | 0.25–0.56 GB (E2 for two cards) | Yes | Free | MIT code / MIT English & streaming; non-commercial legacy non-English (E2) | Medium | macOS, Windows, Linux |

Reading the local matrix:

- **Qwen3-ASR 0.6B** has the best Chinese/Cantonese and mixed-language results in the
  same transcribe.cpp harness, plus Apache-2.0. Its cost is 850 MB and a heavier memory
  footprint; the 8 GB Mac spike decides whether it can be the default.
- **SenseVoice Small** is the lightweight tier: 253 MB, fast, good Chinese, but lower
  Chinese/Cantonese accuracy and a FunASR weight license that needs legal review.
- Whisper small is the portable English-biased fallback; Whisper medium is the accuracy
  fallback if small misses the quality bar and the latency budget still allows it.
- WhisperKit is an Apple-only accelerator, evaluated only if the portable Whisper path
  misses R2 on Apple Silicon.
- Parakeet and Moonshine fail R1 for Chinese in v0.1; Vosk fails the quality bar; Paraformer
  is a Chinese-only baseline.

### Cloud candidates

| Provider | Chinese | English | Mixed | Latency shape | Cost | Offline | License | Integration | Platform |
|---|---:|---:|---:|---|---|---|---|---|---|
| **OpenAI gpt-4o-transcribe / mini / whisper-1** | 5 | 5 | 5 | Batch ~1–3 s plus network; realtime available | ~$0.003–0.006/min (E3) | No | Commercial ToS | Low (HTTPS) | Any with network |
| **Deepgram Nova-3** | 3–4 | 5 | 3–4 | Low-latency streaming | ~$0.008/min PAYG (E3) | No | Commercial ToS | Low–medium (WS/HTTP) | Any with network |
| **AssemblyAI Universal** | 4 | 5 | 4 | Streaming and batch | ~$0.006/min (E3) | No | Commercial ToS | Low–medium | Any with network |
| **Qwen3 ASR Realtime** | 5 | 4 | 5 | Low latency in-region | Usage-based (E3) | No | Commercial ToS | Medium (DashScope auth/region) | Any with network |
| **Google / Azure / AWS** | 4–5 | 5 | 4 | Streaming and batch | Usage-based, tiered (E3) | No | Commercial ToS | Medium–high (cloud auth) | Any with network |

Cloud is a quality ceiling and an escape hatch for users who accept the privacy trade-off.
It is not a substitute for the local default: it cannot satisfy R3 or R6, and it adds
account, billing, and data-residency concerns.

## Recommendation

Adopt a **local-first default with an optional cloud BYOK adapter**, and treat the exact
model as **provisional until the benchmark in the next section is complete**:

1. **Default local model: Qwen3-ASR 0.6B Q8_0 through transcribe.cpp.** It has the best
   Chinese, Cantonese, and mixed-language results among local candidates in the same
   transcribe.cpp harness, and Apache-2.0 is the cleanest licensing position. Q8_0 is
   about 850 MB; the 8 GB Mac audio spike must confirm peak memory and p95 latency before
   this is locked.
2. **Lightweight tier: SenseVoice Small Q8_0 through transcribe.cpp.** At 253 MB it fits
   8 GB Macs and is much faster than Qwen3, but its Chinese/Cantonese accuracy is lower
   and its FunASR weight license needs legal review. If the license is unacceptable, drop
   SenseVoice entirely and keep Qwen3 + Whisper.
3. **Fallback / English-heavy option: Whisper small**, with **Whisper medium** as the
   accuracy fallback. Use whisper.cpp as the Whisper sidecar; selecting Whisper should be a
   user-visible setting and a documented fallback, not a silent model swap.
4. **No live partials in v0.1.** Capture → VAD/endpointing → final inference after stop →
   post-processing → injection. This matches the observed Typeless behavior (E3) and keeps
   the provider contract final-only.
5. **Latency target: p50 < 1.5 s and p95 ≤ 3 s after stop/end-of-speech** for a 10 s
   utterance on Apple Silicon with the local provider, consistent with ARCHITECTURE.md.
   Do not hide latency behind optimistic partials.
6. **Cloud: optional OpenAI, Deepgram, AssemblyAI, Qwen3 ASR Realtime, or
   Google/Azure/AWS adapters**, each disabled until the user enables it, supplies a key,
   and accepts a data notice. No automatic cloud fallback.
7. **Runtime shape: transcribe.cpp sidecar supervised by Electron main.** One runtime
   covers Qwen3, SenseVoice, and optional Parakeet/Moonshine. Keep sherpa-onnx as the
   backup if transcribe.cpp is unstable on Windows/Vulkan or if Paraformer/Zipformer
   streaming is needed later; use whisper.cpp only for the Whisper fallback. Do not link a
   native ASR addon into Electron main.
8. **Do not choose WhisperKit as the default.** Keep it as a benchmark candidate for the
   macOS fast path if the portable runtime misses R2. Adding a Swift/CoreML model path
   raises solo-maintenance cost and does not help Windows.
9. **Benchmark before locking.** The recommendation is a prior, not a decision. The
   benchmark must clear the license, offline, quality, latency, memory, and cold-start
   gates below before the model ids and default flags are frozen. Keep Qwen3 vocabulary
   prompting off by default until the echo behavior is measured.

Why not SenseVoice as the default: it is smaller and faster, but it is behind Qwen3 on
Chinese and Cantonese in the same harness, and its FunASR weight license adds legal risk.
It remains valuable as the lightweight tier.

Why not cloud-first: it contradicts the local-first differentiation, requires accounts and
network, and makes the privacy story vendor-dependent (the same conclusion as
ARCHITECTURE.md Option E).

Why not a single Whisper model: Whisper small is weak on Chinese, and medium/large may miss
the 1.5 s target on CPU/Metal. Qwen3-ASR provides a better quality-latency point for the
primary language pair.

Revisit triggers: Qwen3-ASR peak memory or p95 latency misses R2 on an 8 GB Mac; Qwen3
vocabulary echo cannot be controlled; SenseVoice weight-license attribution is unworkable;
the benchmark shows Whisper materially beats Qwen3 after post-processing; or the product
adds a language outside the Qwen3/SenseVoice sets.

## Benchmark Plan

The benchmark is an offline, reproducible evaluation run before the model ids are locked.
It does not run in this research card and does not require paid API accounts.

### Datasets

| Bucket | Dataset / source | Size target | Notes |
|---|---|---|---|
| Chinese clean | AISHELL-1 test set | Full test split or a fixed 500-utterance sample | Read speech; use only if its license is acceptable for evaluation |
| Chinese in-the-wild | Internal recordings plus, if licensed, WenetSpeech test subsets | 100–300 utterances | Meetings, pauses, disfluencies; check dataset license before use |
| English clean | LibriSpeech test-clean | 500–1,000 utterances | CC BY 4.0; standard WER comparability |
| English noisy/accented | LibriSpeech test-other + Common Voice English sample | 300–500 utterances | Common Voice is CC0; include multiple accents |
| Mixed zh/en | Internal code-switching set | 100–200 utterances | Primary mixed-language evidence; public CS datasets (for example SEAME) often have restrictive licenses |
| Names / technical terms | Internal term list (product names, APIs, repos, file paths, acronyms) | 50–100 terms in 50–100 utterances | Score exact/normalized term recall separately |
| Noise robustness | MUSAN noise mixed at 5/10/15 dB SNR, plus real microphone recordings | 100–200 mixtures | Use built-in mic and AirPods; do not rely on synthetic noise alone |
| Edge cases | Short utterances (< 1 s), silence, long utterances (20–90 s), trailing silence | 50 cases | Qwen3-ASR accepts ~87 min per call; SenseVoice has a 30 s segment limit; verify VAD/chunking behavior |

Record dataset versions, licenses, and checksums. Do not commit restricted audio to the
public repository; keep evaluation audio outside the repo or use only redistributable
samples.

### Metrics

- **Chinese CER** after text normalization (remove punctuation for scoring, normalize
  digits and Latin tokens consistently).
- **English WER** after lowercasing and punctuation removal.
- **Mixed-language error rate** per utterance, plus separate Chinese-span and English-span
  errors; do not hide code-switch failures inside an aggregate CER.
- **Proper-noun / technical-term recall** and exact-match rate.
- **Final latency**: stop/end-of-speech → final text, p50 and p95, for 5 s, 10 s, and 30 s
  utterances.
- **RTF** (audio seconds / inference seconds).
- **Cold start**: sidecar launch → model ready, first run and warm run.
- **Peak RSS** for the sidecar and the app during inference.
- **Model size** on disk (all files, not just the main checkpoint).
- **Stability**: crashes, timeouts, empty outputs, and repeated-run variance.
- **Optional**: energy impact and thermal throttling on a fanless Mac.

### Hardware and environment

- Apple Silicon: at least one base M-series machine (8 GB) and one 16 GB Pro-class machine;
  record chip, RAM, macOS version, and power state.
- Intel Mac: one supported machine if v0.1 still targets Intel; otherwise mark Intel as
  unsupported and document it.
- Windows: deferred to the Windows helper card; do not block v0.1 on it.
- Fixed audio pipeline: 16 kHz mono PCM, same VAD/endpointing, same post-processing, same
  microphone, same room. Run each configuration three times and report median and p95.
- Local runs with networking disabled to prove R6.

### Decision criteria

Hard gates (any failure disqualifies a candidate as the default):

1. License permits commercial distribution with the required attribution.
2. Fully offline after model download.
3. Chinese CER and English WER meet the proposed thresholds on clean data, and mixed
   utterances remain usable (no catastrophic code-switch failure).
4. p50 latency < 1.5 s and p95 ≤ 3 s on the base Apple Silicon machine for 10 s utterances.
5. Peak sidecar RSS ≤ 2 GB and default model download ≤ 1 GB.
6. Cold start ≤ 2 s after the sidecar binary is warm on disk.
7. No crashes or timeouts across the evaluation set.

Proposed quality thresholds (to be confirmed after the first run, not claimed as achieved):

- Chinese CER ≤ 8% clean, ≤ 15% noisy.
- English WER ≤ 8% clean, ≤ 15% noisy.
- Mixed-language error rate ≤ 15% with no language span above 25%.
- Proper-noun recall ≥ 85% before optional vocabulary post-processing.

Selection rule:

- If Qwen3-ASR passes all hard gates on the 8 GB machine, make it the default; keep
  SenseVoice Small as the lightweight tier if its license clears, and Whisper small as the
  explicit multilingual fallback.
- If Qwen3-ASR passes quality but misses memory/latency on 8 GB, make SenseVoice the
  default on 8 GB and offer Qwen3 as the 16 GB+ quality mode.
- If SenseVoice fails legal review, drop it; use Qwen3 as the default and Whisper small as
  the fallback.
- If Qwen3 and SenseVoice both miss the quality gates, benchmark Whisper medium and
  WhisperKit before relaxing R2 or enabling cloud.
- If no local candidate passes, keep local as the default for privacy but expose cloud as
  an explicit quality option; do not silently change the privacy default.

Record the benchmark as a table of candidate × dataset × metric, with the winning
configuration, model checksums, runtime version, and hardware. The output is the evidence
that unlocks the final model decision.

## Model Distribution

**First-run download, not bundled.** ADR-0002 already identifies bundled models as a
bundle-size risk. The base installer should contain the app and the runtime binaries, not
the model weights.

- **First run:** explain the local model, its size, and its license; require consent;
  download with progress and resume; verify before use; allow cancel and retry.
- **Bundled alternative:** a separate “offline installer” or enterprise bundle may include
  SenseVoice int8 later if users need zero-network installation. Do not make it the default
  v0.1 path.
- **Catalog:** a versioned JSON catalog with model id, version, runtime, language set,
  file list, byte size, SHA-256, license id, source URL, and minimum app version. Pin
  Hugging Face revisions or release asset versions; never download an unversioned “latest”.
- **Checksums:** verify SHA-256 of every file after download and before loading. Use an
  atomic temp-directory download and rename; reject partial or mismatched files. A signed
  catalog is a future hardening step, not a v0.1 requirement.
- **Hosting:** project-owned GitHub Releases and/or Hugging Face. A mirror is optional;
  never accept an arbitrary user-supplied model URL in v0.1.
- **Disk:** default Qwen3-ASR 0.6B Q8_0 ~850 MB; lightweight SenseVoice Q8_0 ~253 MB;
  optional Whisper small ~0.5 GB; optional Whisper medium ~1.5 GB. Show disk usage in
  settings and provide delete/re-download.
- **Licenses:** ship the license text and NOTICE for every downloaded model. The FunASR
  model license requires attribution and model-name care; CC-BY-4.0 would require
  attribution if Parakeet were ever added; Moonshine's non-commercial Chinese weights must
  not be offered.
- **Failure handling:** missing or corrupt model → prompt to repair; no silent fallback to
  cloud; keep the audio buffer only if the user enabled retry (ARCHITECTURE.md).

## License Findings

Verified against primary artifacts on 2026-10-26. “GitHub API” means the repository
license endpoint; “raw LICENSE” means the license file was fetched directly; “HF API”
means the Hugging Face model metadata endpoint. These are E2.

| Component | Code license | Weights license | Verification | Note |
|---|---|---|---|---|
| openai/whisper | MIT | Apache-2.0 on the HF model cards | E2 GitHub API; E2 HF API (`whisper-small`, `whisper-medium`) | Reference implementation; not a shipping runtime |
| whisper.cpp | MIT | Models are distributed separately by the project/community | E2 raw LICENSE on `ggml-org/whisper.cpp` | Repo moved from `ggerganov/whisper.cpp`; MIT confirmed |
| WhisperKit | MIT | Whisper-family weights, check the specific model card | E2 raw LICENSE | Swift/CoreML; macOS-only |
| Qwen3-ASR | Apache-2.0 | **Apache-2.0** (official weights) | E2 transcribe.cpp pin; E3 HF model card/blog | Quality default; 30 languages + auto-detect; third-party GGUF/OpenASR conversions need per-artifact verification |
| SenseVoice | MIT | **FunASR Model Open Source License Agreement v1.1**, not MIT | E2 raw LICENSE; E2 README license section; HF card reports `license: other` | Lightweight tier; commercial use permitted with Section 2.2 attribution/model-name requirements per the official clarification; legal review required; third-party conversions may differ |
| FunASR | MIT | Separate `MODEL_LICENSE` per model | E2 GitHub API | Python toolkit; do not ship; model terms matter |
| sherpa-onnx | Apache-2.0 | N/A (runtime) | E2 GitHub API | Backup runtime; Qwen3-ASR support not confirmed |
| NVIDIA NeMo | Apache-2.0 | **Parakeet TDT 0.6B v2/v3 weights are CC-BY-4.0** | E2 raw LICENSE; E2 HF API | Apache-2.0 covers NeMo code, not the Parakeet weights |
| Vosk | Apache-2.0 | Model-specific; check each model | E2 GitHub API | Node bindings; accuracy baseline |
| Moonshine | MIT | MIT for English and all streaming models; **non-commercial** for legacy non-streaming non-English models | E2 raw LICENSE; E2 HF API (`moonshine-base-zh` reports `other`) | Do not ship the Chinese non-streaming weights |
| transcribe.cpp | MIT | N/A (runtime) | E2 GitHub API | Selected runtime; supports Qwen3-ASR + SenseVoice + Parakeet |
| onnxruntime / onnxruntime-node | MIT | N/A (runtime) | E2 GitHub API | Direct-ONNX escape hatch |
| Silero VAD | MIT | MIT | E2 GitHub API | Candidate VAD; validate with the ASR pipeline |
| Cloud providers | Commercial | Commercial | E3 vendor terms | BYOK; data leaves device; verify retention and residency |

Important correction to the shorthand used in planning: “SenseVoice MIT” is true for the
repository code, but **not** for the official model weights. The weights use the FunASR
Model License with commercial-use conditions. This must be reflected in the NOTICE and in
any claim that the default model is MIT. If the attribution/model-name conditions are
unacceptable, choose a different Chinese model or obtain explicit permission before
shipping.

## Decision Status

**Decided (direction):**

- Local-first default, optional cloud BYOK, no silent cloud failover.
- Final-only transcripts in v0.1; no live partials.
- Sidecar process supervised by Electron main; no native ASR addon in the main process.
- Target p50 < 1.5 s after stop, p95 ≤ 3 s for a 10 s utterance on Apple Silicon.
- Benchmark before locking the model.
- Qwen3-ASR 0.6B is the quality-default prior; SenseVoice Small is the lightweight tier;
  transcribe.cpp is the selected runtime.

**Provisional (pending benchmark):**

- Qwen3-ASR 0.6B Q8_0 as the quality default; final quantization and model lock pending.
- SenseVoice Small as the lightweight tier, subject to FunASR legal review.
- Whisper small (and medium as needed) as the multilingual fallback.
- transcribe.cpp as the selected runtime; sherpa-onnx as backup; whisper.cpp only for the
  Whisper fallback.
- WhisperKit only if the portable path misses the latency target on macOS.
- Cloud provider priority: OpenAI and Qwen3 first for language coverage, then Deepgram,
  AssemblyAI, and hyperscalers if users ask for them.

**Pre-launch self-review:** passed for this research card. The document is docs-only,
verifiable against the cited artifacts, and does not claim unmeasured benchmark results.

## Sources

All URLs accessed 2026-10-26 unless noted.

### Primary artifacts inspected (E2)

- GitHub license API: `https://api.github.com/repos/<owner>/<repo>/license` for
  `openai/whisper`, `ggerganov/whisper.cpp`, `FunAudioLLM/SenseVoice`,
  `QwenLM/Qwen3-ASR`, `modelscope/FunASR`, `k2-fsa/sherpa-onnx`, `NVIDIA/NeMo`,
  `alphacep/vosk-api`, `usefulsensors/moonshine`, `argmaxinc/WhisperKit`,
  `handy-computer/transcribe.cpp`, `snakers4/silero-vad`, `microsoft/onnxruntime`.
- Raw licenses:
  - https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/LICENSE (MIT)
  - https://raw.githubusercontent.com/FunAudioLLM/SenseVoice/main/LICENSE (MIT)
  - https://raw.githubusercontent.com/NVIDIA/NeMo/main/LICENSE (Apache-2.0)
  - https://raw.githubusercontent.com/moonshine-ai/moonshine/main/LICENSE (MIT plus
    non-commercial legacy non-English model carve-out)
  - https://raw.githubusercontent.com/argmaxinc/WhisperKit/main/LICENSE (MIT)
- SenseVoice README license section:
  https://github.com/FunAudioLLM/SenseVoice (MIT code; weights under FunASR Model License)
- Hugging Face model metadata:
  - https://huggingface.co/api/models/Qwen/Qwen3-ASR-0.6B
  - https://huggingface.co/api/models/FunAudioLLM/SenseVoiceSmall
  - https://huggingface.co/api/models/openai/whisper-small
  - https://huggingface.co/api/models/openai/whisper-medium
  - https://huggingface.co/api/models/nvidia/parakeet-tdt-0.6b-v2
  - https://huggingface.co/api/models/nvidia/parakeet-tdt-0.6b-v3
  - https://huggingface.co/api/models/moonshine-ai/moonshine-base-zh
  - https://huggingface.co/api/models/moonshine-ai/moonshine-streaming-small

### Public documentation and third-party sources (E3)

- Seeding links from the task card:
  - https://github.com/openai/whisper
  - https://github.com/ggerganov/whisper.cpp (redirects to `ggml-org/whisper.cpp`)
  - https://github.com/FunAudioLLM/SenseVoice
  - https://github.com/modelscope/FunASR
  - https://github.com/k2-fsa/sherpa-onnx
  - https://github.com/NVIDIA/NeMo
  - https://github.com/alphacep/vosk-api
  - https://github.com/usefulsensors/moonshine (redirects to `moonshine-ai/moonshine`)
  - https://github.com/argmaxinc/WhisperKit
  - https://github.com/handy-computer/transcribe.cpp
  - https://github.com/snakers4/silero-vad
- Typeless reverse-engineering notes:
  https://github.com/zephyr4123/speakmore/blob/main/targets/typeless/docs/00-overview.md
- Runtime and model documentation:
  - transcribe.cpp Qwen3-ASR docs: https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/qwen3-asr.md
  - transcribe.cpp SenseVoice docs: https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/sensevoice-small.md
  - Qwen3-ASR model card: https://huggingface.co/Qwen/Qwen3-ASR-0.6B
  - Qwen3-ASR blog: https://qwen.ai/blog?id=qwen3asr
  - Qwen3-ASR technical report: https://arxiv.org/abs/2601.21337
  - sherpa-onnx documentation: https://k2-fsa.github.io/sherpa/onnx/
  - whisper.cpp README: https://github.com/ggml-org/whisper.cpp
  - WhisperKit README: https://github.com/argmaxinc/WhisperKit
  - Vosk model list: https://alphacephei.com/vosk/models
  - Silero VAD README: https://github.com/snakers4/silero-vad
  - NeMo ASR documentation: https://docs.nvidia.com/nemo-framework/
- Cloud vendor documentation and pricing (verify before implementation):
  - OpenAI speech-to-text: https://platform.openai.com/docs/guides/speech-to-text
  - OpenAI pricing: https://openai.com/api/pricing/
  - Deepgram pricing: https://deepgram.com/pricing
  - AssemblyAI pricing: https://www.assemblyai.com/pricing
  - Alibaba Cloud Model Studio / Qwen ASR: https://www.alibabacloud.com/help/en/model-studio/
  - Google Cloud Speech-to-Text: https://cloud.google.com/speech-to-text
  - Azure AI Speech: https://azure.microsoft.com/en-us/products/ai-services/ai-speech
  - Amazon Transcribe: https://aws.amazon.com/transcribe/
- Project context:
  - [docs/ADR-0001-core-boundary.md](ADR-0001-core-boundary.md)
  - [docs/ADR-0002-tech-stack.md](ADR-0002-tech-stack.md)
  - [docs/ARCHITECTURE.md](ARCHITECTURE.md)

## Open Questions

1. **Qwen3-ASR memory/latency on the base machine:** does Qwen3-ASR 0.6B Q8_0 through
   transcribe.cpp hit p50 < 1.5 s and stay under the peak-RSS gate on an 8 GB M-series Mac,
   including sidecar startup, VAD, and post-processing? If not, is SenseVoice the 8 GB
   default with Qwen3 as a 16 GB+ mode?
2. **Qwen3-ASR vocabulary echo and punctuation:** the transcribe.cpp port warns that 0.6B
   echoes vocabulary prompts more often than 1.7B. Does punctuation/digit output remain
   stable with vocabulary prompting off, and is a separate punctuation model needed?
3. **SenseVoice weight-license compliance:** read the FunASR Model Open Source License
   Agreement v1.1 and its Section 2.2 in full, confirm attribution/model-name obligations,
   and decide whether SenseVoice can ship as the lightweight tier. If not, drop it.
4. **SenseVoice punctuation/ITN:** transcribe.cpp enables ITN by default; verify that the
   resulting punctuation/casing/digits meet the dictation rubric and measure the English
   WER cost.
5. **Mixed-language quality:** how much do Qwen3-ASR and SenseVoice degrade on English
   technical terms embedded in Mandarin, and does Whisper small/medium close the gap enough
   to justify a second model download?
6. **Fallback policy:** should the app ship Qwen3 + SenseVoice + Whisper, or only Qwen3 +
   Whisper on 8 GB machines? The benchmark decides based on quality, memory, and download
   size.
7. **WhisperKit / runtime:** is WhisperKit materially faster than transcribe.cpp/whisper.cpp
   on Apple Silicon? If yes, is a macOS-only second runtime worth the maintenance cost?
8. **VAD choice:** transcribe.cpp has no VAD, so Silero VAD in core is the default
   candidate. Measure endpointing latency and false-cut behavior against a runtime VAD.
8. **Model hosting:** GitHub Releases versus Hugging Face versus both; who pays for
   bandwidth; how are checksums and catalog signatures distributed?
9. **Cloud priority:** which provider gets the first adapter? OpenAI has the broadest
   quality; Qwen3 may be stronger for Mandarin and cheaper in-region; user demand should
   decide.
10. **Data residency and retention:** for each cloud provider, document retention, training
    use, and region controls before showing the data notice.
11. **Windows path:** which runtime and model survive the Windows helper port?
    transcribe.cpp, sherpa-onnx, and whisper.cpp are the portable candidates; WhisperKit is
    not.
12. **Partial transcripts:** revisit in v0.2. If added, the provider interface needs a
    streaming capability and the UI needs a stable partial-text policy; do not retrofit it
    into v0.1.
