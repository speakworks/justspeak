# Technical Decisions Index

- Status: living index for the v0.1 technical plan
- Last updated: 2026-10-26
- Scope: documentation only

This index records the technical decisions contained in the v0.1 planning documents and
points to the document that owns each decision. The linked document is the source of truth;
this page is a map, not a second specification.

**No application code exists yet.** The repository currently contains documentation and
project scaffolding only. Nothing described here is implemented, measured, or validated in
a running app, and no benchmark in these documents has been executed. "Accepted" means
accepted as a design baseline for v0.1, not shipped behavior.

## How to use these docs

1. Read [ADR-0001](ADR-0001-core-boundary.md) and [ADR-0002](ADR-0002-tech-stack.md) first
   for the core boundary and stack, then [ARCHITECTURE](ARCHITECTURE.md) for the process
   model and trust boundaries.
2. Read the topic documents for the area you are changing: ASR, audio, injection, LLM
   post-processing, privacy/security, packaging/release, Windows, testing, v0.2, licensing.
3. Treat the linked document as authoritative. If this index and a document disagree, the
   document wins and the index should be corrected; if two documents disagree, record the
   conflict in [Open cross-document decisions](#open-cross-document-decisions) instead of
   silently picking one.
4. Do not treat a "Proposed" or "Pending benchmark" decision as approval to implement. Check
   the document's own entry and validation gates before writing code.
5. Status legend:
   - **Accepted** — decided for v0.1 and used as a design baseline.
   - **Proposed** — recommended design, not yet approved or validated.
   - **Pending benchmark** — deliberately provisional until measurements clear stated gates.
   - **Open** — unresolved, or requires legal/engineering review.
6. A decision marked "Accepted" can still have open sub-questions; the last column names the
   ones known today.
7. Product scope and version sequencing remain in [ROADMAP](ROADMAP.md). This index does not
   change the roadmap.

### Document map

- [ADR-0001: Core boundary and repository strategy](ADR-0001-core-boundary.md) — single
  repository with an internal `core` boundary; split criteria for v0.2.
- [ADR-0002: Technology stack](ADR-0002-tech-stack.md) — Electron/TypeScript stack and
  native-helper approach.
- [ADR-0003: Replaceable provider boundaries](ADR-0003-provider-boundaries.md) — ASR,
  capture, injection, and hotkey adapters behind stable interfaces.
- [ARCHITECTURE: v0.1 architecture](ARCHITECTURE.md) — process model, data flow, trust
  boundaries, failure handling.
- [ASR-RESEARCH: ASR strategy](ASR-RESEARCH.md) — local-first model/runtime options,
  benchmark plan, model distribution.
- [AUDIO-PIPELINE: Capture, VAD, and streaming](AUDIO-PIPELINE.md) — capture path, framing,
  VAD, latency budget.
- [TEXT-INJECTION-HOTKEYS: Hotkeys and text injection](TEXT-INJECTION-HOTKEYS.md) —
  global hotkeys, clipboard/Accessibility injection, focus context.
- [LLM-POSTPROCESSING: Cleanup pipeline](LLM-POSTPROCESSING.md) — rule-based baseline,
  optional cloud LLM, validator, benchmark plan.
- [PRIVACY-SECURITY: Privacy and security design](PRIVACY-SECURITY.md) — data inventory,
  threat model, consent, security controls.
- [PACKAGING-RELEASE: Packaging and release](PACKAGING-RELEASE.md) — signing,
  notarization, updater, model download, release process.
- [WINDOWS-PORT: Windows strategy](WINDOWS-PORT.md) — helper language, WASAPI capture,
  injection, packaging, phased delivery.
- [TESTING-STRATEGY: Testing and CI](TESTING-STRATEGY.md) — test pyramid, tooling,
  benchmark harness, CI, performance gates.
- [V0.2-SPEAKPILOT: SpeakPilot plan](V0.2-SPEAKPILOT.md) — v0.2 architecture, permission
  model, safety controls, model routing.
- [LICENSING: Licensing and compliance](LICENSING.md) — dependency and model-weight
  licenses, notices, checklist.

## Decision index

| Decision | Status | Document | One-line rationale | Open question |
|---|---|---|---|---|
| Core boundary and single-repository strategy: one repo with an internal `core`; app → core dependency rule; split only when a trigger is met | Accepted | [ADR-0001](ADR-0001-core-boundary.md) | Avoids premature packaging while keeping a future split a refactor rather than a rewrite | When to extract `packages/core` or a separate SpeakPilot repository (v0.2); concrete layout once the stack is fixed |
| Desktop stack: Electron 45 + TypeScript + React 19 + electron-vite 6 + Swift helper | Accepted | [ADR-0002](ADR-0002-tech-stack.md) | TypeScript velocity plus an out-of-process native helper for OS I/O, with a Windows-later path | Renderer-first capture baseline (#1 decided; amendment pending); minimum macOS version; bundle/memory budget; overlay strategy; storage choice; Electron upgrade policy; telemetry scope |
| Process model and trust boundaries: sandboxed renderer, narrow preload, orchestrating main process, framework-neutral core, OS-only helper | Accepted | [ARCHITECTURE](ARCHITECTURE.md) | Enforceable boundaries keep product logic testable and OS capabilities out of the renderer | Per-app injection compatibility; architecture amendments for renderer-first and clipboard-first (#1/#2 decided; amendments pending) |
| Local-first ASR with optional cloud BYOK adapters | Accepted | [ASR-RESEARCH](ASR-RESEARCH.md) | On-device default preserves privacy and offline use; cloud is an explicit escape hatch, never a silent fallback | Model/runtime lock; benchmark gates (CER/WER, latency, memory, cold start); cloud provider terms |
| Default ASR prior: Qwen3-ASR 0.6B Q8_0 via transcribe.cpp; SenseVoice Small lightweight tier; Whisper small/medium fallback | Pending benchmark | [ASR-RESEARCH](ASR-RESEARCH.md) | Best same-pipeline Chinese/Cantonese quality with a permissive Apache-2.0 default; SenseVoice is smaller/faster but needs FunASR legal review | Final model/quant lock; SenseVoice license/attribution; Whisper fallback selection; Parakeet English-only |
| Replaceable provider boundaries: `AsrProvider`, `CaptureSource`, `InjectionStrategy`, `HotkeySource` | Accepted | [ADR-0003](ADR-0003-provider-boundaries.md) | Model/runtime/platform swaps become adapter changes instead of UI/core rewrites | IPC transport; process ownership; streaming interface; model-registry signing |
| Final-only transcripts; no live partials in v0.1 | Accepted | [ASR-RESEARCH](ASR-RESEARCH.md), [AUDIO-PIPELINE](AUDIO-PIPELINE.md) | Simplifies the provider contract and avoids hiding latency behind optimistic partials | Live partial transcripts deferred; whether v0.2 adds them (#6) |
| Audio pipeline: renderer Web Audio capture + AudioWorklet, Silero VAD optional, final-only local ASR, `CaptureSource` fallback to Swift `AVAudioEngine` | Accepted (renderer-first; VAD/chunk parameters pending spike) | [AUDIO-PIPELINE](AUDIO-PIPELINE.md), [ADR-0003](ADR-0003-provider-boundaries.md) | One TypeScript audio stack and low stop latency; helper-side capture remains comparator and fallback behind the same interface | VAD model/thresholds, chunk size, resampler placement, audio spike gates; ARCHITECTURE/ADR-0002 amendment |
| Hotkeys and injection: Electron `globalShortcut` toggle; clipboard + `Cmd+V` default; Accessibility insert later opt-in | Accepted (clipboard-first; AX later) | [TEXT-INJECTION-HOTKEYS](TEXT-INJECTION-HOTKEYS.md), [ADR-0003](ADR-0003-provider-boundaries.md) | Predictable cross-app injection with secure-field safeguards and a copy-only fallback | Default shortcut conflict sweep; app compatibility matrix; timing of AX opt-in; ARCHITECTURE step 6 amendment |
| Post-processing: rule-based baseline on by default + opt-in BYOK cloud LLM + mandatory deterministic validator | Accepted (baseline); provider/model pending benchmark | [LLM-POSTPROCESSING](LLM-POSTPROCESSING.md) | Improves cleanup quality without breaking local-first or privacy; validator prevents bad rewrites | Provider/model choice; prompt text and guard thresholds; tone-by-app defaults; local LLM deferred |
| Privacy/security baseline: minimal context, local-first, no retention or telemetry by default, direct distribution | Accepted | [PRIVACY-SECURITY](PRIVACY-SECURITY.md) | Least-data collection satisfies the privacy promise while keeping dictation useful | Telemetry/crash provider; encryption at rest; surrounding-text caps; consent copy review |
| Packaging/release: electron-vite + electron-builder, Developer ID signing + notarization, DMG + ZIP, electron-updater via GitHub Releases, first-run model download | Accepted | [PACKAGING-RELEASE](PACKAGING-RELEASE.md) | Direct distribution is the only v0.1-compatible path; free CI plus a local fallback fits a solo maintainer | Signing/notarization spike; update feed operations; model download and offline pack; notices filename migration (#4 decided; packaging doc pending) |
| Windows port: reuse Electron and `src/core`; C#/.NET helper leading candidate; WASAPI helper capture; clipboard + `Ctrl+V`; NSIS + Authenticode | Accepted (strategy; helper language pending spike) | [WINDOWS-PORT](WINDOWS-PORT.md) | Maximum reuse with a reversible helper-language decision and renderer capture as fallback | Helper language pending spike; cross-platform capture amendment (#1 decided; docs pending); Windows 10 best-effort scope; signing identity |
| Testing/CI: Vitest, Playwright Electron E2E, pnpm frozen lockfile, GitHub Actions macOS arm64, ASR benchmark harness | Accepted | [TESTING-STRATEGY](TESTING-STRATEGY.md) | Fake-first tests and required CI gates catch boundary regressions before OS-level manual checks | Packaging doc npm-to-pnpm migration (#3 decided; doc pending); Playwright Electron support is experimental; performance ceilings still unmeasured |
| v0.2 SpeakPilot: reuse Electron + Swift helper with hardening; `src/agent`, isolated planner, brokered tools | Accepted (plan; performance gates) | [V0.2-SPEAKPILOT](V0.2-SPEAKPILOT.md) | Reuses the shipped shell/core while isolating privileged planning and actions behind policy and confirmation | Capabilities not frozen; v0.1 entry gate; repository split trigger; permission and audit details; native action service if hot path demands |
| Licensing and compliance: MIT project plus per-dependency/model license matrix and legal review before commercial release | Accepted (design; legal review open) | [LICENSING](LICENSING.md) | Application dependencies are largely MIT-compatible, but model-weight terms vary and require attribution and legal review | Legal review pending; SenseVoice/Parakeet/Vosk adoption; notices filename migration (#4 decided; packaging doc pending); model-license nuance (#5) |

Status roll-up: 15 Accepted, 1 Pending benchmark, 0 Proposed, 0 Open (16 decisions).
Mixed-status rows are counted by their leading status.

## Open cross-document decisions

These are the remaining deviations and migrations recorded after the acceptance pass.
Items marked "decided" still need the source-document edit; "pending" items need a spike or
legal review.

### 1. Capture ownership — decided; architecture amendment pending

- Accepted: renderer Web Audio/AudioWorklet is the v0.1 default; Swift `AVAudioEngine` is
  the fallback behind `CaptureSource` ([ADR-0003](ADR-0003-provider-boundaries.md)).
- Windows later uses WASAPI helper capture with renderer Web Audio fallback; the
  cross-platform difference is accepted as an architecture amendment item.
- Remaining: the audio spike measures renderer p95; amend ARCHITECTURE/ADR-0002 to match
  the accepted renderer-first baseline.

### 2. Injection order — decided; architecture amendment pending

- Accepted: clipboard + `Cmd+V` is the v0.1 default; Accessibility direct insertion is a
  later opt-in behind `InjectionStrategy`; CGEvent typing is a per-app fallback.
- Remaining: per-app compatibility matrix, secure-input/terminal behavior, and the
  ARCHITECTURE step 6 amendment to clipboard-first + AX upgrade.

### 3. Package manager — decided; packaging doc migration pending

- Accepted: pnpm with a frozen lockfile, pinned through Corepack
  ([TESTING-STRATEGY](TESTING-STRATEGY.md)).
- Remaining: update `PACKAGING-RELEASE.md` release steps from `npm ci` to pnpm before the
  scaffold.

### 4. Third-party notices filename — decided; packaging doc migration pending

- Accepted: `THIRD_PARTY_NOTICES.md` at the repository root
  ([LICENSING](LICENSING.md)).
- Remaining: update `PACKAGING-RELEASE.md` and the packaged app/About-window links from
  `THIRD-PARTY-NOTICES` to the canonical name.

### 5. License nuance — accepted with legal gate

- Qwen3-ASR 0.6B is Apache-2.0 and the quality default.
- SenseVoice Small weights are under the FunASR Model Open Source License, not MIT; it is
  the lightweight tier and requires legal review.
- Parakeet weights are CC-BY-4.0 if adopted; Moonshine legacy non-English models are
  non-commercial and excluded; Vosk model licenses are per-model.
- Nothing in [LICENSING](LICENSING.md) or this index is a legal conclusion. Legal review
  remains a release gate; no model ships without cleared terms.

### 6. Pending decisions

- Final ASR model/quantization lock after the benchmark ([ASR-RESEARCH](ASR-RESEARCH.md)).
- Provider-boundary implementation: adapters, model registry, contract tests
  ([ADR-0003](ADR-0003-provider-boundaries.md)).
- Packaging, signing, notarization, and the update feed ([PACKAGING-RELEASE](PACKAGING-RELEASE.md)).
- Windows helper language after the spike ([WINDOWS-PORT](WINDOWS-PORT.md)).
- v0.2 capabilities and the v0.1 entry gate ([V0.2-SPEAKPILOT](V0.2-SPEAKPILOT.md)).
- Live partial transcripts, deferred from v0.1 ([ASR-RESEARCH](ASR-RESEARCH.md)).
- Question: assign an owner and decision date to each, and close it before the matching
  release gate rather than letting a provisional choice become accidental policy.
