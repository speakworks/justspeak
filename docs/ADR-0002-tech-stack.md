# ADR-0002: Technology stack for JustSpeak v0.1

- Status: Accepted
- Date: 2026-10-26
- Decision owner: FD2008
- Depends on: [ADR-0001: Core boundary and repository strategy](ADR-0001-core-boundary.md)
- Scope: application shell, language, UI framework, build tooling, and native-integration shape for v0.1.

## Context

JustSpeak v0.1 is an open-source (MIT) desktop dictation product. The user presses a
hotkey, speaks, and clean text appears at the cursor of the focused application.

The forces that shape this decision:

- **macOS first, Windows later.** v0.1 ships on macOS. The architecture must not make a
  later Windows port a rewrite.
- **Solo developer with a TypeScript background.** One language for UI, orchestration, and
  core logic maximizes shipping speed. Native code should be small and isolated.
- **Local-first differentiation.** Audio should be processable on-device by default, with
  cloud ASR as an explicit opt-in. The product must not depend on a vendor cloud account.
- **Shared core with SpeakPilot v0.2.** ADR-0001 requires a framework-neutral `core`
  boundary (audio pipeline, VAD, ASR adapters, post-processing, model management,
  transcription settings schema) that a second product can reuse.
- **The hard parts are OS integration, not UI.** Global hotkeys, reading the focused
  application/input context, microphone capture, and text injection into arbitrary apps
  are platform APIs. Every serious competitor isolates them in native code.
- **Public evidence only.** This ADR uses open repositories, package manifests, release
  artifacts, vendor documentation, and public reverse-engineering notes. No paid accounts
  or private telemetry were used.

The application stack was not finalized in ADR-0001; this ADR records it. Packaging,
code signing/notarization, the Windows helper language, and the local ASR runtime are
separate cards and remain out of scope here.

## Decision

Adopt the following baseline for JustSpeak v0.1:

1. **Shell:** Electron 45 (pinned to the 45.x line).
2. **Language:** TypeScript across the main process, preload, renderer, and `src/core`.
3. **UI:** React 19 in the renderer.
4. **Build tooling:** electron-vite 6 for main/preload/renderer builds.
5. **Native integration:** a **small, out-of-process Swift helper** on macOS for global
   hotkey/event tap, microphone capture, focused-application context, and text injection.
   It communicates with the TypeScript app over a versioned, length-prefixed IPC contract.
6. **Platform order:** macOS-first. A Windows helper later implements the same contract;
   no Windows packaging work in v0.1.
7. **Core boundary:** `src/core` stays free of Electron, React, DOM, and OS-specific APIs,
   per ADR-0001, so it can be reused by SpeakPilot and by a future shell change.

Exact patch versions are pinned in the lockfile at implementation time. The baseline
versions above were the current stable releases on the decision date (Electron 45.0.0,
electron-vite 6.0.0, React 19.3.1).

Explicitly **not** decided here: packaging/signing path, auto-update provider, Windows
helper language, local ASR runtime, and any UI-framework change.

## Options

### Option A — Electron 45 + TypeScript + React 19 + electron-vite 6 + Swift helper (chosen)

**Shape.** Electron main process hosts the TypeScript `core` and session state machine;
a sandboxed React renderer provides settings, history, and the recording overlay; a
preload script exposes a narrow typed bridge; a small Swift helper owns OS-level APIs.

**Pros**

- Highest solo-developer velocity: one language (TypeScript) for UI, orchestration, core,
  tests, and tooling. React 19 and electron-vite 6 are current and well documented.
- The shell is proven for exactly this product category: Typeless, Wispr Flow, SpeakMore,
  SpeakType, and OpenWhispr all ship Electron shells. Two of them (Typeless, Wispr Flow)
  pair Electron with native helpers, the same shape proposed here.
- Large ecosystem for UI, audio decoding, HTTP/WebSocket, SQLite, logging, and testing.
- Windows reuse is strong: the same main/preload/renderer code runs on Windows; only the
  helper and packaging differ.
- The Swift helper gives full native reach (Accessibility API, CGEventTap, AVAudioEngine,
  Keychain) without exposing FFI to the main process.

**Cons**

- Bundle size is the worst of the candidates: Electron bundles Chromium and Node.js.
  Measured public artifacts: OpenWhispr macOS DMG 313.9 MB, SpeakType Windows installer
  104.6 MB. JustSpeak can ship smaller (no bundled ASR models), but the runtime floor is
  tens of megabytes, not single digits.
- Memory footprint is higher than a native or Tauri shell. This ADR did **not** measure
  RSS; it must be measured before setting a product budget.
- Electron ships a browser engine, so the security surface and update cadence are larger.
  The renderer must be sandboxed and must not load remote content.
- Two languages in the repository (TypeScript + Swift) and a process boundary to test.
- Electron's ~8-week major cadence creates recurring upgrade work.

**Complexity.** Medium. The shell and UI are straightforward for a TypeScript developer;
the main complexity is the helper contract and macOS permissions.

**Windows reuse.** High. Main, preload, renderer, and core are portable. A Windows helper
(C#, Rust, or C++) is required and is a separate card.

**Native integration.** High. The helper can call any macOS API; Electron itself only
needs mic permission and app lifecycle.

**Bundle/memory.** Bundle: poor (measured 100–300 MB class). Memory: unmeasured, expected
higher than native/Tauri; must be validated.

**Evidence.** E2: Electron 45.0.0, electron-vite 6.0.0, React 19.3.1 (npm registry);
SpeakMore Electron 44.7.0; SpeakType Electron 43.6.0; OpenWhispr Electron 41.10.7.
E3: Typeless Electron 33 with four Swift dylibs; Wispr Flow Electron `app.asar` with a
Swift helper. Release-size measurements are E2 (public release artifacts).

### Option B — Tauri 2 + Rust + TypeScript

**Shape.** Rust backend, TypeScript/React frontend in the system WebView (WKWebView on
macOS, WebView2 on Windows), Tauri plugins for global shortcuts, clipboard, and updates.
Native macOS APIs are reached through Rust crates (`objc2`, `core-foundation`) or a
sidecar/helper.

**Pros**

- Much smaller bundles: OpenTypeless ships a 14.3 MB universal macOS DMG and a 4.7 MB
  Windows installer; feichuans/speakMore ships an 8.4 MB DMG. Tauri explicitly markets
  "smaller bundle size by using the system's native webview".
- Lower baseline memory than Electron (system WebView, no bundled Chromium).
- Rust backend is fast and memory-safe; strong Windows path (WebView2 is present on
  modern Windows).
- Both reference projects prove the stack can ship a dictation product with global
  hotkeys and text injection.

**Cons**

- The solo developer's TypeScript background does not cover Rust. Native integration,
  audio capture, and injection would be written in Rust, a new language for this project.
- macOS Accessibility/CGEventTap/AVAudioEngine work in Rust is less documented than in
  Swift; `objc2` bindings add unsafe code and maintenance.
- Local ASR would use Rust bindings (`whisper-rs`, `sherpa-rs`) or a sidecar. Fewer
  maintained examples than the Electron/native-helper pattern.
- Smaller ecosystem for desktop UI edge cases (overlay windows, tray behavior, updater)
  than Electron; more time spent on framework gaps.
- Tauri's system-WebView approach means rendering differences between macOS and Windows,
  which must be tested on both.

**Complexity.** Medium-high for this developer: the shell is simple, but Rust and
Objective-C interop are not.

**Windows reuse.** Very high. One Rust codebase plus WebView2.

**Native integration.** High. Tauri plugins cover hotkeys/clipboard; deeper macOS APIs
need Rust/Objective-C work or a helper.

**Bundle/memory.** Best measured bundle sizes of all candidates. Memory not measured here,
but the architecture avoids bundling Chromium.

**Evidence.** E2: OpenTypeless `@tauri-apps/api` 2.11.0 and `tauri = "=2.11.2"`;
feichuans/speakMore `@tauri-apps/api` ^2.10.1, `@tauri-apps/cli` ^2, GitHub language Rust;
release assets 14.3 MB / 4.7 MB / 8.4 MB. E3: Tauri documentation ("smaller bundle size by
using the system's native webview").

### Option C — Swift + SwiftUI

**Shape.** Native macOS app in Swift/SwiftUI, using AVAudioEngine, Speech/WhisperKit,
Accessibility API, CGEventTap, and Keychain directly.

**Pros**

- Best native integration and lowest overhead on macOS: no bridge, no bundled browser,
  direct access to every Apple API.
- Best bundle/memory profile on macOS; native look and permissions behavior.
- Proven by VoiceInk, justspeaktoit, and superwhisper (local inference) in this category.
- Local ASR is straightforward via WhisperKit/whisper.cpp/sherpa-onnx Swift packages.

**Cons**

- Windows reuse is weak. Swift on Windows exists (justspeaktoit has a developer-preview
  Windows/Linux build sharing a Swift core), but the UI, permissions, and text-injection
  layers must be rewritten, and the Swift/Windows toolchain and ecosystem are immature.
- The solo developer's TypeScript background does not transfer; SwiftUI and AppKit are a
  new stack.
- Speaks against the v0.2 SpeakPilot goal if that product needs Windows or a shared
  TypeScript core. A Swift core is reusable across Apple platforms; the Windows/Linux
  Swift path exists (justspeaktoit proves it) but is immature and would not reuse the
  TypeScript ecosystem or SpeakPilot's likely stack.
- macOS-only reach limits the open-source contributor pool.

**Complexity.** Medium for a Swift developer, high for a TypeScript developer.

**Windows reuse.** Low. A separate Windows application is effectively required.

**Native integration.** Best possible on macOS.

**Bundle/memory.** Best on macOS (single-digit to low-tens of MB before models).

**Evidence.** E2: VoiceInk README (native macOS, local models, macOS 15+, GPLv3);
justspeaktoit `Package.swift` (Swift 5.9, SwiftUI, macOS/iOS, Windows/Linux developer
preview sharing a Swift core). E3: superwhisper vendor docs (local voice models, offline).

### Option D — Python prototype

**Shape.** Python prototype for ASR/VAD/post-processing experiments, with a native or
Electron shell added later for hotkeys and injection.

**Pros**

- Fastest experimentation for audio/ML: `faster-whisper`, `sherpa-onnx`, `silero-vad`,
  `sounddevice`, and a mature data ecosystem.
- Good for validating local ASR quality, latency, and post-processing prompts before
  committing to a production runtime.
- Low ceremony for a solo developer exploring model choices.

**Cons**

- Not a production desktop stack for this product: UI, hotkeys, permissions, and text
  injection all require a second stack or brittle PyObjC glue.
- Packaging is painful: PyInstaller bundles the interpreter and dependencies; macOS
  signing/notarization of a frozen Python app plus native wheels is fragile.
- Startup time, memory, and bundle size are worse than a native/Tauri shell; the GIL and
  Python audio callbacks add latency risk.
- A prototype shell would be thrown away, so it does not reduce the real v0.1 work.

**Complexity.** Low for the prototype, high for productionization.

**Windows reuse.** Medium for the Python logic, low for the shell.

**Native integration.** Low without PyObjC/cffi; high effort for full coverage.

**Bundle/memory.** Unattractive for a desktop app: PyInstaller bundles the interpreter
and every dependency, and ML dependencies (Torch, CUDA libraries, model runtimes) can
push the artifact well past a trimmed Electron build. Size depends heavily on the chosen
inference stack and is not measured here.

**Evidence.** E3: PyInstaller documentation (bundles a Python application and all its
dependencies into a single package); documented general properties of the Python audio/ML
ecosystem. No shipping dictation product in the sampled set uses Python as its shell.

## Comparison Matrix

Scores are 1 (worst) to 5 (best). Weights reflect the forces in Context. Scores are the
author's judgment informed by the evidence below, not measured benchmarks.

| Criterion | Weight | A: Electron + TS + Swift helper | B: Tauri 2 + Rust + TS | C: Swift + SwiftUI | D: Python prototype |
|---|---:|---:|---:|---:|---:|
| Solo-developer velocity / TypeScript reuse | 0.25 | 5 | 3 | 3 | 3 |
| Native integration depth (hotkey, context, injection) | 0.20 | 4 | 4 | 5 | 2 |
| Windows reuse / cross-platform path | 0.20 | 4 | 5 | 2 | 3 |
| Bundle size and memory | 0.10 | 2 | 5 | 5 | 1 |
| Local ASR ecosystem and local-first fit | 0.15 | 4 | 4 | 4 | 5 |
| Ecosystem maturity, security tooling, community | 0.10 | 5 | 3 | 2 | 3 |
| **Weighted total** | **1.00** | **4.15** | **3.95** | **3.45** | **2.90** |

Reading the matrix:

- Tauri is the strongest alternative and wins on bundle, memory, and Windows reuse. It
  loses on this developer's velocity and on Rust/macOS interop risk.
- Swift wins on native depth and bundle but fails the Windows-later requirement and the
  TypeScript-reuse goal.
- Python is a valid prototype tool, not a shipping shell.
- Electron wins because the product's differentiator is not bundle size; it is dictation
  quality, latency, and native integration. The Swift helper supplies the native depth,
  while Electron supplies the velocity, UI ecosystem, and Windows path.

## Recommendation

Adopt **Option A: Electron 45 + TypeScript + React 19 + electron-vite 6 + a small Swift
helper**, macOS-first, with a versioned helper contract that a Windows helper can
implement later.

Rationale:

1. **Velocity for a solo TypeScript developer.** One language covers UI, session logic,
   core, and tests. The only non-TypeScript code is the small helper.
2. **Market-proven shell shape.** Five of the ten sampled products use Electron; the two
   category leaders sampled (Typeless, Wispr Flow) pair an Electron shell with native
   helpers. This is evidence that the shape can achieve fast, native-feeling dictation,
   not proof that it is easy.
3. **Native depth is preserved.** Accessibility, event tap, audio capture, and injection
   live in Swift, where the APIs and examples are strongest on macOS.
4. **Windows-later is a helper swap, not a rewrite.** Main, preload, renderer, and core
   stay portable. A Windows helper (language decided separately) implements the same
   contract.
5. **Core reuse for SpeakPilot.** Keeping `src/core` framework-neutral means a future
   shell change (including Tauri) can reuse the audio/ASR/post-processing pipeline.

Why not Tauri now: the measured bundle advantage is real (14.3 MB vs 313.9 MB in sampled
apps, though those apps bundle different features), but the cost is Rust for the exact
OS-integration work that is hardest to get right. For a solo TypeScript developer, that
trades the product's critical path for a non-critical metric.

Why not Swift now: it fails the explicit Windows-later requirement and the shared-core
goal. It remains the right benchmark for native feel, and JustSpeak should match its
latency and permission behavior.

Why not Python: it is a prototyping tool. Use it only for offline ASR experiments if
needed; do not make it the shipping shell.

**Revisit triggers.** Re-open this decision if any of the following becomes true:

- Measured idle/recording memory or installer size materially hurts adoption or the
  local-first story (set a numeric budget in a follow-up performance card).
- The helper contract stabilizes and a Rust/Tauri rewrite can reuse the core without
  touching the pipeline.
- The project gains a maintainer with Rust expertise and Windows becomes the primary
  market.
- Electron 45 packaging or native-helper support proves unworkable on the target macOS
  versions.

**Reversal cost.** Changing the shell means rewriting main/preload/renderer and the
helper binding, but not `src/core` if the boundary is respected. This is why the core
must not import Electron.

## Evidence

Tags: **E2** = primary artifact inspected directly (code, package manifest, release
binary metadata, npm registry). **E3** = web/third-party (vendor docs, third-party
analysis, hiring material). Accessed 2026-10-26.

| ID | Tag | Claim | Source | Confidence / note |
|---|---|---|---|---|
| E2-1 | E2 | Electron 45.0.0 is the current stable release | `registry.npmjs.org/electron/latest` | High; version resolves at decision date |
| E2-2 | E2 | electron-vite 6.0.0 is current | `registry.npmjs.org/electron-vite/latest` | High |
| E2-3 | E2 | React 19.3.1 is current | `registry.npmjs.org/react/latest` | High |
| E2-4 | E2 | SpeakMore uses Electron 44.7.0 | `zephyr4123/speakmore` `package.json` | High; manifest checked |
| E2-5 | E2 | SpeakType uses Electron 43.6.0, electron-vite 5.0.0, React 19.2.8 | `wookat/speaktype` `desktop/package.json` | High; manifest checked |
| E2-6 | E2 | OpenWhispr uses Electron ^41.10.7, React 19, TypeScript | `OpenWhispr/openwhispr` `package.json`, README | High; README states "Electron 41" |
| E2-7 | E2 | OpenTypeless uses Tauri 2.11.2 + Rust | `tover0314-w/opentypeless` `package.json`, `src-tauri/Cargo.toml` | High; both manifests checked |
| E2-8 | E2 | feichuans/speakMore uses Tauri 2 + Rust + React 19 | `feichuans/speakMore` `package.json`; GitHub language = Rust | High; no license file observed |
| E2-9 | E2 | justspeaktoit is Swift 5.9/SwiftUI, macOS/iOS, with a Windows/Linux developer preview sharing the Swift core | `crmitchelmore/justspeaktoit` `Package.swift`, README | High; shows Swift cross-platform is possible but immature |
| E2-10 | E2 | VoiceInk is a native macOS app with local models, macOS 15+, GPLv3 | `Beingpax/VoiceInk` README, Xcode project | High; license matters for code reuse |
| E2-11 | E2 | Measured release sizes: OpenWhispr 313.9 MB macOS DMG / 242.5 MB Windows EXE; OpenTypeless 14.3 MB universal DMG / 4.7 MB EXE; feichuans/speakMore 8.4 MB DMG; SpeakType 104.6 MB Windows installer | GitHub Releases API assets | High for the artifacts; bundles include different features/models |
| E3-1 | E3 | Typeless is Electron 33 with four Swift dynamic libraries (accessibility, clipboard, keyboard, audio devices); ASR and cleanup run server-side | Third-party reverse-engineering: `zephyr4123/speakmore` `targets/typeless/docs/00-overview.md` | Medium-high; extracted from a shipped build, but third-party analysis |
| E3-2 | E3 | Wispr Flow is Electron (`app.asar`) with macOS Swift and Windows C# native helpers over a stdio IPC contract; vendor site lists Mac/Windows/iPhone/Android | `wispr-flow-linux/wispr-flow-linux` recovered docs; `docs.wisprflow.ai` MDM guide; `wisprflow.ai` | Medium; third-party reverse engineering plus vendor deployment docs |
| E3-3 | E3 | superwhisper runs local voice models offline; Windows/iOS/Android also supported | `superwhisper.com/docs/get-started/introduction.md`; `superwhisper.com` | High for the local-inference claim; the shell language is not vendor-documented, so treat "Swift shell" as inferred |
| E3-4 | E3 | Electron inherits Chromium's multi-process model; main runs Node.js; renderer should use contextIsolation/sandbox; app bundles Electron + Chromium + Node.js | Electron process-model and security docs | High; official docs |
| E3-5 | E3 | Tauri uses the system native webview and markets smaller bundles | Tauri "What is Tauri?" docs | High; official docs |
| E3-6 | E3 | PyInstaller bundles a Python app and all dependencies into a single package | PyInstaller manual | High; shows packaging is possible, not that it is low-friction |

Bundle sizes are measurements of **public release artifacts**, not of JustSpeak. They
include different feature sets and bundled models; use them as an order-of-magnitude
signal only. Memory was not measured for this ADR.

## Consequences

**Positive**

- Fastest path for a solo TypeScript developer to a shippable macOS app.
- React 19 and electron-vite 6 are current, documented, and support fast iteration.
- Native integration is isolated in a small Swift helper, keeping the TypeScript surface
  testable and the helper replaceable.
- Windows later reuses main, preload, renderer, and core; only the helper and packaging
  are platform-specific.
- The core boundary from ADR-0001 stays intact and remains reusable by SpeakPilot.
- The chosen shape matches the dominant pattern among sampled competitors, reducing
  unknown-unknowns in dictation UX.

**Negative / trade-offs**

- Larger installer and higher memory than Tauri/Swift; this must be measured and may
  require trimming the renderer and avoiding bundled models.
- Electron's Chromium/Node security surface requires disciplined sandboxing, CSP, IPC
  validation, and a regular upgrade cadence.
- Two languages and an IPC boundary add testing and debugging overhead.
- macOS permissions (Microphone, Accessibility, Input Monitoring) create onboarding
  friction that the helper and UI must explain clearly.

**Operational**

- Pin Electron 45.x, electron-vite 6.x, and React 19.x in the lockfile; review major
  upgrades on a fixed cadence rather than continuously.
- The helper contract must be versioned from day one; a version mismatch must fail
  gracefully, not crash the app.
- Packaging/signing/notarization and the Windows helper language are deferred to separate
  cards; this ADR only fixes the shape.

**Licensing**

- Electron (MIT), React (MIT), and electron-vite (MIT) are compatible with this MIT
  project. Swift is Apache-2.0 with a runtime exception; a Swift helper is compatible.
- VoiceInk is GPLv3 and feichuans/speakMore has no observed license. They are used as
  **evidence only**. Do not copy code from them.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bundle/memory undermines the local-first positioning | Medium | Medium | Do not bundle ASR models; lazy-download; measure installer and RSS; set a numeric budget in a performance card; revisit Tauri if missed |
| Electron/Chromium vulnerability or stale runtime | Medium | High | Stay on a supported major; sandbox renderer; no remote content; CSP; validate all IPC; track Electron security releases |
| Swift helper crashes or is blocked by permissions | Medium | High | Small command surface; helper restart with state reset; explicit permission onboarding; clipboard-copy fallback when injection fails |
| Local ASR runtime is awkward from TypeScript | High | High | Keep ASR behind a provider interface; run local engines in a sidecar process (transcribe.cpp/sherpa-onnx/whisper.cpp) or the helper; runtime selected in ASR-RESEARCH/ADR-0003 |
| Electron 45 is new and some packaging/native tooling lags | Medium | Medium | Pin 45.x, smoke-test packaging early, keep a tested fallback to 44.x if a blocker appears |
| Windows helper diverges from the macOS contract | Medium | Medium | Versioned contract, contract tests with a fake helper, shared fixtures; Windows helper language decided separately |
| Solo developer context-switches between TS and Swift | Medium | Medium | Keep the helper deliberately small; document each command; avoid moving product logic into Swift |
| Copying GPLv3/no-license competitor code | Low | High | Evidence-only policy; license review before accepting any external code |
| macOS minimum version excludes users | Low | Medium | Decide the minimum in a follow-up; Electron 45 support and Swift API availability constrain it |

## Open Questions

1. **Local ASR runtime for v0.1:** resolved in ASR-RESEARCH/ADR-0003 — transcribe.cpp
   selected, with sherpa-onnx and whisper.cpp as backups; final model lock pending
   benchmark.
2. **Audio capture owner:** Swift helper (AVAudioEngine) versus renderer `getUserMedia`.
   This ADR recommends the helper; validate latency and permission behavior with a spike.
3. **Minimum supported macOS version:** Electron 45 and the Swift APIs used by the helper
   must agree. Decide before packaging.
4. **Windows helper language:** C#, Rust, or C++. Separate card; the contract must not
   assume Swift types.
5. **Packaging, signing, notarization, and auto-update provider:** separate card.
6. **Bundle/memory budget:** define target installer size and idle/recording RSS, then
   measure. Revisit the stack if the budget cannot be met.
7. **Overlay window strategy:** transparent always-on-top BrowserWindow versus native
   panel; affects renderer complexity and permissions.
8. **Settings/history storage:** JSON versus SQLite; retention defaults; encryption at
   rest for transcripts.
9. **Electron upgrade policy:** which cadence and how many majors behind is acceptable.
10. **Telemetry/analytics scope:** opt-in only; must never include audio or transcript
    content.

## Sources

Accessed 2026-10-26.

Primary artifacts (E2):

- Electron current version: https://registry.npmjs.org/electron/latest
- electron-vite current version: https://registry.npmjs.org/electron-vite/latest
- React current version: https://registry.npmjs.org/react/latest
- SpeakMore package manifest: https://github.com/zephyr4123/speakmore/blob/main/package.json
- SpeakType desktop manifest: https://github.com/wookat/speaktype/blob/main/desktop/package.json
- OpenWhispr package manifest: https://github.com/OpenWhispr/openwhispr/blob/main/package.json
- OpenWhispr README: https://github.com/OpenWhispr/openwhispr/blob/main/README.md
- OpenTypeless package manifest: https://github.com/tover0314-w/opentypeless/blob/main/package.json
- OpenTypeless Rust manifest: https://github.com/tover0314-w/opentypeless/blob/main/src-tauri/Cargo.toml
- feichuans/speakMore package manifest: https://github.com/feichuans/speakMore/blob/main/package.json
- justspeaktoit Package.swift: https://github.com/crmitchelmore/justspeaktoit/blob/main/Package.swift
- justspeaktoit README: https://github.com/crmitchelmore/justspeaktoit/blob/main/README.md
- VoiceInk README: https://github.com/Beingpax/VoiceInk/blob/main/README.md
- VoiceInk Xcode project: https://github.com/Beingpax/VoiceInk/blob/main/VoiceInk.xcodeproj/project.pbxproj
- Release asset sizes: GitHub Releases API for `OpenWhispr/openwhispr` (v1.10.4),
  `tover0314-w/opentypeless` (v1.1.61), `feichuans/speakMore` (v1.4.0),
  `wookat/speaktype` (v0.20.1).

Web and third-party (E3):

- Typeless reverse-engineering overview: https://github.com/zephyr4123/speakmore/blob/main/targets/typeless/docs/00-overview.md
- Wispr Flow Linux reverse-engineering notes: https://github.com/wispr-flow-linux/wispr-flow-linux/blob/main/CLAUDE.md
- Wispr Flow MDM deployment guide: https://docs.wisprflow.ai/articles/9363440133-Deploy-Wispr-Flow-via-MDM
- Wispr Flow product site: https://wisprflow.ai/
- superwhisper product site: https://superwhisper.com/
- superwhisper introduction docs: https://superwhisper.com/docs/get-started/introduction.md
- Electron process model: https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Tauri "What is Tauri?": https://v2.tauri.app/start/
- PyInstaller manual: https://pyinstaller.org/en/stable/
- Existing project decisions: [docs/ADR-0001-core-boundary.md](ADR-0001-core-boundary.md),
  [README.md](../README.md), [docs/ROADMAP.md](ROADMAP.md)
