# Licensing and Compliance Checklist

> **Status:** Accepted engineering design; legal review pending. Last verified: 2026-10-26.
>
> **This document is not legal advice.** It records what the project's own files and the
> upstream license sources say, and it lists the questions that require counsel before a
> commercial release. License texts and model terms change; re-verify them at integration
> time and at every release that adds or upgrades a component.

## Scope and Evidence Tags

This document covers the JustSpeak application (MIT), the candidate local ASR runtimes and
model weights, the planned application stack, and cloud ASR providers. It does not cover
evaluation datasets, third-party fonts, or content copied into marketing pages; those need
their own review when introduced.

Evidence tags used below:

- **E2** = verified in this repository (code, config, manifests, or project docs inspected
  directly).
- **E3** = web or third-party source (upstream repository license endpoint, raw license
  file, model card, or vendor terms fetched from the official source).

"Verified" means the license identifier or license text was read from the official upstream
source on 2026-10-26. It does not mean a lawyer has accepted the terms.

## Project License

JustSpeak is released under the **MIT License**.

- `LICENSE` contains the standard MIT text, `Copyright (c) 2026 FD2008` (E2).
- `README.md` states "MIT — see [LICENSE](../LICENSE)" (E2).
- There is no `package.json` or lockfile in the repository yet, so the application
  dependency licenses are not yet frozen in a manifest (E2).

What MIT means for this project, in plain terms:

- Anyone may use, copy, modify, merge, publish, distribute, sublicense, and sell the
  project's code, provided the copyright notice and permission notice are included in all
  copies or substantial portions.
- The license includes no warranty and **no express patent grant**.
- MIT applies only to code the project owns. Third-party code, binaries, and model weights
  keep their own licenses; the project license does not relicense them.

## Dependencies

### Planned application stack

These are the stack decisions from ADR-0002. They are not yet in a manifest, so their exact
versions will be pinned at implementation time.

| Component | License | Verification | Notes |
|---|---|---|---|
| Electron 45 | MIT | E2 (ADR-0002) | Electron distributions bundle Chromium and Node.js; preserve Electron's `LICENSE` and its Chromium/Node third-party notices. |
| React 19 | MIT | E2 (ADR-0002) | Include the MIT notice in the notices bundle. |
| electron-vite 6 | MIT | E2 (ADR-0002) | Build-time only; include in the notices bundle because it is distributed in source builds and lockfiles. |
| Swift helper toolchain | Apache-2.0 with Runtime Library Exception | E2 (ADR-0002) | The runtime exception covers distribution of Swift runtime libraries; include the Apache-2.0 text and any upstream NOTICE. |

Because there is no `package.json` yet, a complete transitive dependency audit is not
possible. Run a license scan over the committed lockfile before the first release.

### ASR runtimes and tools

| Component | Code license | Verification | Role and notes |
|---|---|---|---|
| OpenAI Whisper (`openai/whisper`) | MIT | E3: GitHub license API | Reference implementation; not a planned shipping runtime. Official model weights are separately licensed (see below). |
| whisper.cpp (`ggml-org/whisper.cpp`, formerly `ggerganov/whisper.cpp`) | MIT | E3: GitHub license API; raw `LICENSE` | Candidate sidecar. The repository moved to `ggml-org`; use the current canonical URL. Model files are distributed separately; check the specific conversion/model card. |
| SenseVoice (`FunAudioLLM/SenseVoice`) | MIT | E3: GitHub license API; repository README | Code is MIT. Official weights are **not** MIT; they use the FunASR Model Open Source License Agreement v1.1 (see below). |
| Qwen3-ASR (`QwenLM/Qwen3-ASR`) | Apache-2.0 | E3: official model card/blog; E3: transcribe.cpp model docs | Official Python package; not the shipped runtime. The transcribe.cpp port is the planned runtime path. Weights are Apache-2.0 (see below). |
| FunASR (`modelscope/FunASR`) | MIT | E3: GitHub license API | Python toolkit; not planned as a shipped runtime. Each model carries its own `MODEL_LICENSE`. |
| sherpa-onnx (`k2-fsa/sherpa-onnx`) | Apache-2.0 | E3: GitHub license API; raw `LICENSE` | Backup/alternative multi-model sidecar runtime; Qwen3-ASR support is not confirmed. Apache-2.0 obligations apply (license text, notices, NOTICE file if present). |
| Vosk (`alphacep/vosk-api`) | Apache-2.0 | E3: GitHub license API | Code is Apache-2.0. Vosk model licenses are **model-specific**; verify each candidate model before shipping. |
| Moonshine (`usefulsensors/moonshine`; the LICENSE names `moonshine-ai/moonshine`) | MIT by default, with a composite LICENSE | E3: raw `LICENSE`; GitHub license API reports `NOASSERTION` | The `NOASSERTION` result reflects the composite LICENSE, not an unknown license. Code and default models are MIT; listed legacy non-streaming non-English models are non-commercial (see below). |
| NVIDIA NeMo (`NVIDIA/NeMo`) | Apache-2.0 | E3: GitHub license API | Apache-2.0 covers the framework code, not Parakeet weights. |
| WhisperKit (`argmaxinc/WhisperKit`) | MIT | E3: GitHub license API | Swift/CoreML path for macOS. Weights follow the specific Whisper model card. |
| transcribe.cpp (`handy-computer/transcribe.cpp`) | MIT | E3: GitHub license API | Selected ggml-based runtime for v0.1 (Qwen3-ASR + SenseVoice + optional Parakeet); model licenses are separate. |
| onnxruntime / onnxruntime-node (`microsoft/onnxruntime`) | MIT | E3: GitHub license API | Direct ONNX execution option. |
| Silero VAD (`snakers4/silero-vad`) | MIT | E3: GitHub license API; raw `LICENSE` | Candidate VAD; MIT covers code and the published VAD weights. |
| Cloud ASR providers | Commercial terms | E3: vendor terms | Not open source. OpenAI, Deepgram, AssemblyAI, Qwen3/ DashScope, Google, Azure, and AWS are governed by their service terms, data-processing terms, and branding rules. |

### Model weights

Model weights are licensed separately from the runtime code. This distinction controls
whether the app may download, bundle, or redistribute a model.

| Model family | Weights license | Verification | Redistribution and commercial notes |
|---|---|---|---|
| Whisper official weights (small, medium, large-v3-turbo) | Apache-2.0 on the official Hugging Face model cards | E3: Hugging Face API (`openai/whisper-small`, `openai/whisper-medium`) | Commercial use permitted with Apache-2.0 obligations: license text, notices, and any upstream NOTICE. Community GGML/GGUF conversions may have different model cards; verify the exact artifact. |
| Qwen3-ASR 0.6B official weights | Apache-2.0 | E3: Hugging Face model card (`Qwen/Qwen3-ASR-0.6B`); E3: transcribe.cpp Qwen3-ASR docs | Commercial use permitted with Apache-2.0 obligations. Third-party GGUF/OpenASR conversions may carry different provenance; verify the exact artifact and checksum. |
| SenseVoiceSmall official weights | FunASR Model Open Source License Agreement v1.1 (not MIT); Hugging Face card reports `license: other` | E3: Hugging Face API; FunASR `MODEL_LICENSE`; SenseVoice README | Lightweight tier only, subject to legal review. Commercial use of the official weights is permitted when the model license is followed, per the maintainers' official clarification. Section 2.2 requires attribution of source and author information and retention of relevant model names. Section 3 is a responsibility/risk disclaimer. Third-party conversions may carry different terms. |
| FunASR / Paraformer family | Per-model `MODEL_LICENSE` | E3: FunASR repository | Do not assume MIT because the FunASR toolkit is MIT. Verify the card for the exact model. |
| Parakeet TDT 0.6B v2/v3 | CC-BY-4.0 | E3: Hugging Face API (`nvidia/parakeet-tdt-0.6b-v2`) | Attribution required: creator, source/title, license link, and an indication of changes. CC-BY-4.0 has no patent grant. |
| Moonshine English and all streaming models | MIT | E3: raw `LICENSE` | Commercial use permitted with MIT notice. |
| Moonshine legacy non-streaming non-English models (Arabic, Japanese, Korean, Mandarin, Spanish, Ukrainian, Vietnamese) | Moonshine Community License, **non-commercial** | E3: raw `LICENSE`; `usefulsensors/moonshine-base-zh` reports `license: other` | **Excluded from distribution.** Do not ship or offer these weights, including the Mandarin Base/Tiny models. |
| Vosk models | Model-specific; not verified per model | E3: Vosk API license; individual model pages pending | Treat as unverified until each candidate model's license is read and recorded. |
| Cloud ASR | Commercial service terms | E3: vendor terms | No weights are redistributed. The app calls the service under the provider's commercial terms. |

## Compatibility

The following is an engineering reading of the licenses, not a legal opinion. Confirm the
commercial-release position with counsel.

### MIT project plus Apache-2.0 dependencies

- An MIT-licensed application can include and distribute Apache-2.0 components. The
  Apache-2.0 parts remain under Apache-2.0; the project does not relicense them to MIT.
- Apache-2.0 Section 4 requires the distributor to: give recipients a copy of the Apache
  License; retain copyright, patent, trademark, and attribution notices; reproduce any
  upstream `NOTICE` file; and state significant changes made to Apache-2.0 files.
- Practical effect for JustSpeak: ship the Apache-2.0 text and a `THIRD_PARTY_NOTICES.md`
  entry for sherpa-onnx (and any future Apache-2.0 component), and preserve any upstream
  NOTICE. MIT and Apache-2.0 are compatible for this distribution model.
- MIT-licensed dependencies (whisper.cpp, WhisperKit, onnxruntime, Silero VAD,
  transcribe.cpp, Electron, React, electron-vite) require the copyright line and
  permission text in the notices bundle.

### CC-BY-4.0 weights (Parakeet, if adopted)

- CC-BY-4.0 permits commercial use and redistribution, including bundling, when attribution
  is given: credit the creator, provide a link to the license, link to the source, and
  indicate whether changes were made.
- CC-BY-4.0 grants no patent or trademark rights. If Parakeet is adopted, record the
  attribution string and model-card URL in `THIRD_PARTY_NOTICES.md` and in the app's About
  window, and state whether the weights were converted or quantized.

### FunASR Model Open Source License v1.1 (SenseVoice weights)

- This is a custom model license, not an OSI-approved license. It permits use, copying,
  modification, and sharing, subject to Section 2.2: attribute the source and author
  information and retain the relevant model names.
- Per the maintainers' official clarification, commercial use of the official
  SenseVoiceSmall weights is permitted when the license is followed; Section 3 is a
  responsibility/risk disclaimer rather than an extra non-commercial restriction; and
  fine-tuned derivative weights may remain private. The clarification covers the official
  weights only; third-party conversions may differ.
- Practical effect: do not describe the default model as "MIT". Include the full FunASR
  license text and the required attribution with any downloaded or redistributed weights,
  and obtain legal sign-off on the exact wording before commercial release.
- Redistribution of the weights inside an offline pack should be treated as requiring the
  same license text and attribution as a download, and should be confirmed with counsel
  because the license is not a standard OSI license.

### Moonshine composite license

- The repository LICENSE defaults code and models to MIT, then lists the legacy
  non-streaming non-English models that remain under the non-commercial Moonshine Community
  License. That list is exhaustive. English models and all streaming models are MIT.
- The GitHub license API reports `NOASSERTION` for this repository because the LICENSE is a
  composite document. Use the raw LICENSE text, not the API identifier.
- Practical effect: exclude the listed non-English legacy models (including Mandarin) from
  the catalog and from any offline pack. English-only or streaming Moonshine use is MIT.

### Redistribution versus first-run download

The project has frozen first-run download as the default and has not frozen an optional
offline pack (E2: `docs/ASR-RESEARCH.md`, `docs/PACKAGING-RELEASE.md`).

- **First-run download (default):** the base installer contains no weights. The app
  downloads from a pinned catalog, verifies SHA-256, and stores the files locally. The app
  must still deliver the license text and attribution with the model, because it is
  distributing the weights to the user.
- **Offline pack (optional):** publishing a pack is redistribution. The pack must include
  the applicable license text, notices, attribution, model-card links, and checksums, and
  the import flow must verify them. A pack does not avoid the model license.
- **Bundling in the installer (not selected):** same obligations plus a larger installer
  and update coupling. Revisit only after legal review.
- **Cloud providers:** no weights change hands; the provider's commercial terms and data
  processing terms govern. They do not create an open-source compatibility issue.
- The catalog must record a license identifier and source URL for every model, and the
  download UI must show the license and a link before consent (E2:
  `docs/PACKAGING-RELEASE.md`, `docs/PRIVACY-SECURITY.md`).

### Commercial use

| Component class | Commercial use | Condition |
|---|---|---|
| Project code (MIT) | Yes | Include copyright and permission notice. |
| MIT runtimes (whisper.cpp, WhisperKit, onnxruntime, Silero VAD, transcribe.cpp) | Yes | Include notices. |
| Apache-2.0 runtimes (sherpa-onnx, NeMo code, Vosk code) | Yes | Apache-2.0 notices, license text, NOTICE reproduction. |
| Whisper official weights (Apache-2.0) | Yes | Apache-2.0 notices for the weights. |
| SenseVoice official weights (FunASR Model License) | Permitted per official clarification | Section 2.2 attribution and model-name retention; legal review. |
| Parakeet weights (CC-BY-4.0) | Yes | Attribution and no additional restrictions. |
| Moonshine MIT models | Yes | MIT notice. |
| Moonshine legacy non-English non-streaming models | **No** | Non-commercial; excluded. |
| Vosk models | Depends on each model | Verify each model license. |
| Cloud ASR | Per vendor terms | Accept the provider's commercial terms; no silent enablement. |

### Patent clauses

- **Apache-2.0** includes an express patent grant from contributors, and the grant
  terminates if the recipient initiates patent litigation alleging that the work infringes.
  This is the strongest patent position among the candidate licenses.
- **MIT** has no express patent grant. A permissive copyright license is not a patent
  covenant.
- **CC-BY-4.0** grants no patent or trademark rights.
- **FunASR Model License v1.1** is silent on patents in the reviewed text; do not assume a
  patent grant. Treat this as an open question for counsel.
- **Moonshine Community License** applies only to excluded models; its patent terms were
  not reviewed because those models are not candidates.
- Project-level note: the MIT project license does not grant downstream users a patent
  license from the project's contributors beyond what the MIT text implies.

### License hygiene and excluded code

- The project policy is to use GPLv3 or unlicensed competitor repositories as evidence
  only. VoiceInk is GPLv3; some sampled projects have no observed license (E2:
  `docs/ADR-0002-tech-stack.md`). Do not copy code from them.
- Do not copy code, prompts, or model files whose license is unknown or `NOASSERTION`
  without reading the actual license file.

## Third-Party Notices

`THIRD_PARTY_NOTICES.md` exists at the repository root and is generated by
`pnpm notices` from the production dependency tree and `resources/models.json` (E2). It
must be regenerated whenever a production dependency, the lockfile, or the model catalog
changes; the packaging tests fail when the committed file drifts from the generator.

Checklist for that file:

- Project identification and a reference to the project MIT license.
- One entry per third-party component: name, version or commit/model revision, license
  identifier, copyright line, and source URL.
- Full license texts, or a `licenses/` directory with one file per distinct license.
  Include Apache-2.0's `NOTICE` content when upstream provides it.
- Model-weight entries: license identifier, model-card URL, required attribution string,
  and a note when the artifact is a conversion or quantization.
- Electron/Chromium/Node.js notices preserved from the Electron distribution.
- A "no legal advice" note is not needed in the notices file itself; the notices file is a
  compliance artifact, not an opinion.

Attribution in the product:

- Add a "Third-party notices" link next to the README License section. The README already
  links the MIT LICENSE; it does not yet mention third-party components (E2).
- The app's About window should list runtime and model licenses with links.
- The first-run model consent screen should show the model name, size, license, and a link
  to the license text, and should not bury attribution only in the repository.
- Release notes should state which model is downloaded, its size, and its license.

Naming: the canonical file is `THIRD_PARTY_NOTICES.md` (underscores) at the repository
root. `docs/PACKAGING-RELEASE.md` was updated to use the same name, so the earlier
hyphenated `THIRD-PARTY-NOTICES` conflict is resolved.

## Redistribution

The intended model distribution is first-run download, with an optional separately
published offline pack for air-gapped or managed installs (E2:
`docs/PACKAGING-RELEASE.md`).

| Mode | What is distributed | Compliance requirements |
|---|---|---|
| Base installer | App, runtime binaries, no weights | MIT/Apache-2.0 notices for runtimes and Electron; no model-weight obligations because no weights are present. |
| First-run download | Model weights, delivered over HTTPS to the user's disk | Show license before consent; ship license text and attribution with the model; record license id, source URL, pinned revision, and SHA-256 in the catalog; verify per-file SHA-256 before load. |
| Offline model pack | Model weights in a downloadable archive | All of the download requirements, plus a pack checksum, catalog version, notices, and import-time verification. Treat as redistribution. |
| Bundled installer (not selected) | Model weights inside the installer | All redistribution obligations plus installer size and update coupling; legal review first. |

Provenance requirements already specified by the project:

- A versioned catalog with model id, version, runtime, architecture, file list, byte size,
  SHA-256 per file, license identifier, source URL, and minimum app version (E2:
  `docs/PACKAGING-RELEASE.md`, `docs/PRIVACY-SECURITY.md`).
- Pin Hugging Face revisions or release assets; never download an unversioned "latest".
- Verify SHA-256 after download and before loading; fail closed on a mismatch; use atomic
  install.
- Publish artifact and model checksums with the release; a signed catalog is a later
  hardening step.
- Do not accept an arbitrary user-supplied model URL.

## Checklist

### Repository

- [x] `LICENSE` is the MIT text with the project copyright line (E2).
- [x] `README.md` links the project license (E2).
- [x] Create `THIRD_PARTY_NOTICES.md` at the repository root (`pnpm notices`).
- [ ] Add license texts (or a `licenses/` directory) for every shipped runtime and model.
- [ ] Add the third-party notices link to README and the app About window.
- [ ] Add a license scan and SBOM generation to the release process
      (`docs/PACKAGING-RELEASE.md` already calls for an SBOM).

### Models and weights

- [ ] Freeze the default model after the ASR benchmark.
- [ ] Verify the exact weights artifact and its model card before adding it to the catalog.
- [ ] Add the Qwen3-ASR Apache-2.0 NOTICE and verify the exact GGUF artifact/checksum.
- [ ] Obtain legal sign-off on the FunASR Model License v1.1 attribution and
      redistribution wording for SenseVoice.
- [ ] Exclude the Moonshine legacy non-English non-streaming models from all catalogs and
      packs.
- [ ] Verify each Vosk model license before adopting Vosk.
- [ ] If Parakeet is adopted, add the CC-BY-4.0 attribution and model-card link.
- [ ] Record license identifier, source URL, pinned revision, and SHA-256 in the catalog.
- [ ] Do not label SenseVoice weights as MIT in product copy, README, or release notes.

### Distribution and UX

- [ ] First-run consent shows model name, size, license, and license link.
- [ ] License text and attribution are stored with the downloaded model.
- [ ] Offline pack includes license texts, notices, model-card links, and checksums.
- [ ] Release notes state the downloaded model, size, and license.
- [ ] Electron/Chromium/Node.js notices are preserved in the packaged app.
- [ ] No arbitrary model URLs are accepted.

### Governance

- [ ] Legal review before the first commercial release.
- [ ] Re-verify licenses on every runtime or model upgrade.
- [ ] No GPLv3 or unlicensed code copied (ADR-0002 evidence-only policy).
- [ ] Cloud provider terms and data-processing terms reviewed before enabling each provider.
- [ ] Document that this checklist is not legal advice and record the reviewer and date.

## Decision Status

**Decided:**

- The project is MIT (E2).
- Licensing and dependency research is docs-only and does not change code (task card).
- Dependency and model licenses must be verified from official sources; this document was
  verified on 2026-10-26.
- Legal review is required before commercial release.
- The exact model bundle/download product decision is separate from this document.
- First-run download is the default model mechanism; the base installer does not bundle
  weights (E2: `docs/ASR-RESEARCH.md`, `docs/PACKAGING-RELEASE.md`).
- Moonshine's non-commercial legacy non-English models are excluded.
- GPLv3 and unlicensed competitor code are evidence only, not source material.

**Provisional (pending benchmark or release work):**

- Qwen3-ASR 0.6B as the quality default, SenseVoice Small as the lightweight tier
  (subject to FunASR legal review), with Whisper small/medium as multilingual fallback.
- transcribe.cpp as the selected runtime, with sherpa-onnx as backup (Qwen3-ASR support
  pending verification).
- An optional offline model pack for air-gapped or managed installs.
- `THIRD_PARTY_NOTICES.md` as the canonical notices path (to be confirmed against
  `docs/PACKAGING-RELEASE.md` naming).

**Not decided:**

- Final model lock and quantization after the local benchmark, plus the exact weights
  artifact.
- Whether an offline pack ships with v0.1 or later.
- Whether Parakeet or Vosk is adopted.
- Which cloud providers are offered and under which terms.
- Who performs the legal review and when it is scheduled.

## Open Questions

1. **FunASR attribution wording.** What exact attribution string and model-name placement
   satisfy Section 2.2 for SenseVoiceSmall, and is the About window plus notices file
   sufficient?
2. **FunASR redistribution.** Does the FunASR Model License permit redistributing the
   official weights inside an offline pack or installer, or only download from the
   project's own host with attribution? Counsel should confirm.
3. **SenseVoice conversions.** If the shipped artifact is an int8 ONNX conversion by a
   third party, which model card and license govern it, and does the official clarification
   still apply?
4. **Whisper conversion provenance.** Which exact GGML/GGUF Whisper artifacts will be in
   the catalog, and what license does each conversion's model card state?
5. **Parakeet.** If adopted, what is the required CC-BY-4.0 attribution string, and does the
   conversion/quantization need to be disclosed as a change?
6. **Vosk.** Which Vosk models, if any, are candidates, and what is each model's license?
7. **Cloud terms.** Which providers are in scope, and do their terms permit the intended
   commercial use, branding, and data-processing posture?
8. **Notices naming.** Resolved: the canonical file is `THIRD_PARTY_NOTICES.md`
   (underscores), and `docs/PACKAGING-RELEASE.md` uses the same name.
9. **Legal review timing.** Who reviews this before commercial release, and what evidence
   package do they need (license texts, catalog entries, About-screen mockups)?
10. **Patent posture.** Is the absence of an express patent grant in MIT and in the FunASR
    model license acceptable for the intended commercial distribution?

## Sources

Accessed 2026-10-26. E2 = repository artifact; E3 = web or third-party official source.

### E2 — Repository artifacts

| ID | Claim | Source |
|---|---|---|
| E2-1 | The project license is MIT, copyright 2026 FD2008 | [`LICENSE`](../LICENSE) |
| E2-2 | README states the project is MIT | [`README.md`](../README.md) "License" section |
| E2-3 | Model license findings and requirements R7 | [`docs/ASR-RESEARCH.md`](ASR-RESEARCH.md) "License Findings", "Requirements", "Model Distribution" |
| E2-4 | Model distribution design, checksums, licenses, and attribution | [`docs/PACKAGING-RELEASE.md`](PACKAGING-RELEASE.md) "Model distribution", "Model Distribution Design", "Licenses and attribution" |
| E2-5 | Model download threat model and catalog fields | [`docs/PRIVACY-SECURITY.md`](PRIVACY-SECURITY.md) T4, T11, catalog section |
| E2-6 | Application stack licenses and GPL/no-license evidence-only policy | [`docs/ADR-0002-tech-stack.md`](ADR-0002-tech-stack.md) "Licensing" and "Risks" |
| E2-7 | SpeakPilot reuses the model catalog and checksum design | [`docs/V0.2-SPEAKPILOT.md`](V0.2-SPEAKPILOT.md) |
| E2-8 | No `package.json`, lockfile, or `THIRD_PARTY_NOTICES.md` exists at the repository root | Repository root inspection |

### E3 — Upstream and third-party sources

| ID | Claim | Source |
|---|---|---|
| E3-1 | `openai/whisper` code is MIT | https://api.github.com/repos/openai/whisper/license |
| E3-2 | `ggml-org/whisper.cpp` code is MIT; repository moved from `ggerganov` | https://api.github.com/repos/ggml-org/whisper.cpp/license ; https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/LICENSE |
| E3-3 | `FunAudioLLM/SenseVoice` code is MIT; weights are separate | https://api.github.com/repos/FunAudioLLM/SenseVoice/license ; https://github.com/FunAudioLLM/SenseVoice (README "License") |
| E3-4 | SenseVoiceSmall weights use FunASR Model License v1.1; Hugging Face reports `license: other` | https://huggingface.co/api/models/FunAudioLLM/SenseVoiceSmall ; https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE |
| E3-5 | Official clarification permits commercial use with Section 2.2 attribution and model-name retention | https://github.com/QwenAudio/SenseVoice/issues/334#issuecomment-5083546605 (linked from the official README) |
| E3-6 | `modelscope/FunASR` code is MIT; models carry separate `MODEL_LICENSE` | https://api.github.com/repos/modelscope/FunASR/license ; https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE |
| E3-7 | `k2-fsa/sherpa-onnx` is Apache-2.0 | https://api.github.com/repos/k2-fsa/sherpa-onnx/license ; https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/LICENSE |
| E3-8 | `alphacep/vosk-api` code is Apache-2.0; models are model-specific | https://api.github.com/repos/alphacep/vosk-api/license |
| E3-9 | Moonshine LICENSE is composite: MIT default, non-commercial legacy non-English list; GitHub API reports `NOASSERTION` | https://raw.githubusercontent.com/usefulsensors/moonshine/main/LICENSE ; https://api.github.com/repos/usefulsensors/moonshine/license |
| E3-10 | `usefulsensors/moonshine-base-zh` reports `license: other` | https://huggingface.co/api/models/usefulsensors/moonshine-base-zh |
| E3-11 | `NVIDIA/NeMo` code is Apache-2.0 | https://api.github.com/repos/NVIDIA/NeMo/license |
| E3-12 | Parakeet TDT 0.6B v2 weights are CC-BY-4.0 | https://huggingface.co/api/models/nvidia/parakeet-tdt-0.6b-v2 |
| E3-13 | `argmaxinc/WhisperKit` is MIT | https://api.github.com/repos/argmaxinc/WhisperKit/license |
| E3-14 | `handy-computer/transcribe.cpp` is MIT | https://api.github.com/repos/handy-computer/transcribe.cpp/license |
| E3-15 | `microsoft/onnxruntime` is MIT | https://api.github.com/repos/microsoft/onnxruntime/license |
| E3-16 | `snakers4/silero-vad` is MIT | https://api.github.com/repos/snakers4/silero-vad/license ; https://raw.githubusercontent.com/snakers4/silero-vad/master/LICENSE |
| E3-17 | Official Whisper weights are Apache-2.0 on the model cards | https://huggingface.co/api/models/openai/whisper-small ; https://huggingface.co/api/models/openai/whisper-medium |
| E3-18 | Apache-2.0 terms, including Section 4 notice obligations and patent grant | https://www.apache.org/licenses/LICENSE-2.0 |
| E3-19 | CC-BY-4.0 attribution terms and absence of patent/trademark grants | https://creativecommons.org/licenses/by/4.0/ |
| E3-20 | MIT license text | https://opensource.org/license/mit |
| E3-21 | Cloud provider commercial terms (review at integration, not line-by-line here) | https://openai.com/policies/terms-of-use ; https://deepgram.com/terms ; https://www.assemblyai.com/legal/terms-of-service ; https://www.alibabacloud.com/help/en/legal |
| E3-22 | Qwen3-ASR 0.6B official weights are Apache-2.0; transcribe.cpp ports Qwen3-ASR | https://huggingface.co/Qwen/Qwen3-ASR-0.6B ; https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/qwen3-asr.md |

### Verification method

The upstream license identifiers above were read with the official GitHub license endpoint
(`https://api.github.com/repos/<owner>/<repo>/license`) and the Hugging Face model metadata
endpoint (`https://huggingface.co/api/models/<owner>/<model>`); where the endpoint result
was ambiguous, the raw `LICENSE` file was read. Re-run these checks when a component is
added or upgraded. Do not rely on this document's identifiers alone.
