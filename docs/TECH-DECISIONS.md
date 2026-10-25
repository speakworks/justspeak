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
| Desktop stack: Electron 45 + TypeScript + React 19 + electron-vite 6 + Swift helper | Accepted | [ADR-0002](ADR-0002-tech-stack.md) | TypeScript velocity plus an out-of-process native helper for OS I/O, with a Windows-later path | Audio capture owner (#1 below); minimum macOS version; bundle/memory budget; overlay strategy; storage choice; Electron upgrade policy; telemetry scope |
| Process model and trust boundaries: sandboxed renderer, narrow preload, orchestrating main process, framework-neutral core, OS-only helper | Accepted | [ARCHITECTURE](ARCHITECTURE.md) | Enforceable boundaries keep product logic testable and OS capabilities out of the renderer | Capture ownership (#1); injection order (#2); per-app injection compatibility |
| Local-first ASR with optional cloud BYOK adapters | Pending benchmark | [ASR-RESEARCH](ASR-RESEARCH.md) | On-device default preserves privacy and offline use; cloud is an explicit escape hatch, never a silent fallback | Model/runtime lock; benchmark gates (CER/WER, latency, memory, cold start); cloud provider terms |
| Default ASR prior: SenseVoice Small int8 ONNX via sherpa-onnx, Whisper small/medium fallback | Pending benchmark | [ASR-RESEARCH](ASR-RESEARCH.md) | Best expected Chinese/mixed-language quality per latency and disk without a GPU, with a comparable fallback | Benchmark not run; SenseVoice license/attribution; Whisper fallback selection; WhisperKit kept as candidate only |
| Final-only transcripts; no live partials in v0.1 | Accepted | [ASR-RESEARCH](ASR-RESEARCH.md), [AUDIO-PIPELINE](AUDIO-PIPELINE.md) | Simplifies the provider contract and avoids hiding latency behind optimistic partials | Live partial transcripts deferred; whether v0.2 adds them (#6) |
| Audio pipeline: renderer Web Audio capture + AudioWorklet, Silero VAD, final-only local ASR | Accepted (capture path); VAD/chunk parameters pending spike | [AUDIO-PIPELINE](AUDIO-PIPELINE.md) | One TypeScript audio stack and low stop latency; helper-side capture remains comparator and fallback | Capture ownership conflict (#1); VAD model/thresholds, chunk size, resampler placement, audio spike gates |
| Hotkeys and injection: Electron `globalShortcut` toggle; clipboard + `Cmd+V` default; Accessibility insert later opt-in | Accepted | [TEXT-INJECTION-HOTKEYS](TEXT-INJECTION-HOTKEYS.md) | Predictable cross-app injection with secure-field safeguards and a copy-only fallback | Injection order conflict (#2); default shortcut conflict sweep; app compatibility matrix; timing of AX opt-in |
| Post-processing: rule-based baseline on by default + opt-in BYOK cloud LLM + mandatory deterministic validator | Accepted (baseline); provider/model pending benchmark | [LLM-POSTPROCESSING](LLM-POSTPROCESSING.md) | Improves cleanup quality without breaking local-first or privacy; validator prevents bad rewrites | Provider/model choice; prompt text and guard thresholds; tone-by-app defaults; local LLM deferred |
| Privacy/security baseline: minimal context, local-first, no retention or telemetry by default, direct distribution | Accepted | [PRIVACY-SECURITY](PRIVACY-SECURITY.md) | Least-data collection satisfies the privacy promise while keeping dictation useful | Telemetry/crash provider; encryption at rest; surrounding-text caps; consent copy review |
| Packaging/release: electron-vite + electron-builder, Developer ID signing + notarization, DMG + ZIP, electron-updater via GitHub Releases, first-run model download | Proposed | [PACKAGING-RELEASE](PACKAGING-RELEASE.md) | Direct distribution is the only v0.1-compatible path; free CI plus a local fallback fits a solo maintainer | Signing/notarization spike; update feed operations; model download and offline pack; notices filename (#4) |
| Windows port: reuse Electron and `src/core`; C#/.NET helper leading candidate; WASAPI helper capture; clipboard + `Ctrl+V`; NSIS + Authenticode | Proposed | [WINDOWS-PORT](WINDOWS-PORT.md) | Maximum reuse with a reversible helper-language decision and renderer capture as fallback | Helper language pending spike; audio path conflict (#1); Windows 10 best-effort scope; signing identity |
| Testing/CI: Vitest, Playwright Electron E2E, pnpm frozen lockfile, GitHub Actions macOS arm64, ASR benchmark harness | Proposed | [TESTING-STRATEGY](TESTING-STRATEGY.md) | Fake-first tests and required CI gates catch boundary regressions before OS-level manual checks | Package manager conflict (#3); Playwright Electron support is experimental; performance ceilings still unmeasured |
| v0.2 SpeakPilot: reuse Electron + Swift helper with hardening; `src/agent`, isolated planner, brokered tools | Proposed | [V0.2-SPEAKPILOT](V0.2-SPEAKPILOT.md) | Reuses the shipped shell/core while isolating privileged planning and actions behind policy and confirmation | Capabilities not frozen; v0.1 entry gate; repository split trigger; permission and audit details |
| Licensing and compliance: MIT project plus per-dependency/model license matrix and legal review before commercial release | Open | [LICENSING](LICENSING.md) | Application dependencies are largely MIT-compatible, but model-weight terms vary and require attribution and legal review | Legal review pending; SenseVoice/Parakeet/Vosk adoption; notices filename (#4); model-license nuance (#5) |

Status roll-up: 8 Accepted, 2 Pending benchmark, 4 Proposed, 1 Open (15 decisions).
Mixed-status rows are counted by their leading status.

## Open cross-document decisions

These are known inconsistencies between the source documents. They are recorded here as
open questions and are **not** edited in the source docs by this index. Each needs a
follow-up documentation change, and some need a spike or legal review before a decision.

### 1. Capture ownership

- [AUDIO-PIPELINE](AUDIO-PIPELINE.md) selects renderer Web Audio capture
  (`getUserMedia` → `AudioContext` → `AudioWorklet`) for v0.1 and explicitly records this
  as a deviation from the accepted architecture.
- [ARCHITECTURE](ARCHITECTURE.md) assigns microphone capture (`AVAudioEngine`) to the Swift
  helper. [ADR-0002](ADR-0002-tech-stack.md) open question 2 recommends the helper and
  defers validation to a latency spike. [WINDOWS-PORT](WINDOWS-PORT.md) recommends
  helper-side WASAPI capture with renderer Web Audio as fallback.
- Question: which component owns capture in v0.1, and which path is the documented
  fallback? Resolve with the audio spike, then amend ARCHITECTURE/ADR-0002 or
  AUDIO-PIPELINE so the baseline is unambiguous.

### 2. Injection order

- [TEXT-INJECTION-HOTKEYS](TEXT-INJECTION-HOTKEYS.md) ships clipboard + `Cmd+V` as the
  v0.1 default and defers Accessibility (`axInsert`) to a later opt-in mode for
  whitelisted apps.
- [ARCHITECTURE](ARCHITECTURE.md) step 6 describes Accessibility insertion at the focused
  range first, then clipboard + synthesized paste as the fallback.
- Question: is the default Accessibility-first or clipboard-first, and in what order do
  fallbacks run? Define the per-app compatibility rules and the failure behavior before
  implementation.

### 3. Package manager

- [TESTING-STRATEGY](TESTING-STRATEGY.md) freezes pnpm, pinned through Corepack, and uses
  `pnpm install --frozen-lockfile`.
- [PACKAGING-RELEASE](PACKAGING-RELEASE.md) release steps use `npm ci`.
- Question: pick one package manager and one lockfile policy, then update the other
  document before the scaffold. This is recorded in both docs as a known inconsistency.

### 4. Third-party notices filename

- [LICENSING](LICENSING.md) proposes `THIRD_PARTY_NOTICES.md` as the canonical notices path.
- [PACKAGING-RELEASE](PACKAGING-RELEASE.md) references `THIRD-PARTY-NOTICES` in the shipped
  app.
- Question: what is the canonical filename and extension, where does it live in the
  package, and how is it linked from the About window?

### 5. License nuance

- SenseVoice weights are under the FunASR Model Open Source License, not MIT.
- Parakeet weights are CC-BY-4.0 if Parakeet is adopted.
- Moonshine legacy non-English models are non-commercial and are excluded.
- Vosk model licenses are unverified.
- Legal review is pending. Nothing in [LICENSING](LICENSING.md) or this index is a legal
  conclusion.
- Question: which obligations are acceptable, and which models may ship in v0.1 or in an
  optional offline pack? Counsel should confirm redistribution and attribution wording.

### 6. Pending decisions

- ASR benchmark and model/runtime lock ([ASR-RESEARCH](ASR-RESEARCH.md)).
- Packaging, signing, notarization, and the update feed ([PACKAGING-RELEASE](PACKAGING-RELEASE.md)).
- Windows helper language after the spike ([WINDOWS-PORT](WINDOWS-PORT.md)).
- v0.2 capabilities and the v0.1 entry gate ([V0.2-SPEAKPILOT](V0.2-SPEAKPILOT.md)).
- Live partial transcripts, deferred from v0.1 ([ASR-RESEARCH](ASR-RESEARCH.md)).
- Question: assign an owner and decision date to each, and close it before the matching
  release gate rather than letting a provisional choice become accidental policy.
