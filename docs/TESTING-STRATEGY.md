# Testing and CI Strategy for JustSpeak v0.1

- Status: Proposed (design baseline for v0.1; tool choices are recommendations to validate at scaffold time)
- Date: 2026-10-26
- Decision owner: FD2008
- Depends on: [ADR-0001: Core boundary](ADR-0001-core-boundary.md), [ADR-0002: Technology stack](ADR-0002-tech-stack.md), [ARCHITECTURE.md](ARCHITECTURE.md), [ASR-RESEARCH.md](ASR-RESEARCH.md), [AUDIO-PIPELINE.md](AUDIO-PIPELINE.md), [TEXT-INJECTION-HOTKEYS.md](TEXT-INJECTION-HOTKEYS.md), [PACKAGING-RELEASE.md](PACKAGING-RELEASE.md), [WINDOWS-PORT.md](WINDOWS-PORT.md)
- Scope: test layers and ownership, test tooling, the ASR benchmark harness, CI on GitHub Actions, performance regression gates, and fixtures/mocks. Docs-only: this card writes no test code, installs nothing, and runs no tests.

Evidence tags: **E2** = primary artifact inspected directly (repository design document, package
manifest, configuration, or release metadata). **E3** = web or third-party documentation.
All URLs were accessed on 2026-10-26.

## Context and Constraints

JustSpeak v0.1 is a macOS-first menu-bar dictation app built on Electron 45, TypeScript,
React 19, electron-vite 6, and a small out-of-process Swift helper (ADR-0002). `src/core`
must stay free of Electron, React, DOM, and OS APIs so it can be reused by SpeakPilot and a
future shell (ADR-0001). The architecture reports these load-bearing targets: a sandboxed
renderer with a narrow preload bridge, a versioned main-to-helper contract that fails
closed, local-first processing with cloud ASR only on explicit opt-in, and latency targets
measured end to end (ARCHITECTURE.md, AUDIO-PIPELINE.md).

The test strategy has to protect the seams that are expensive to discover late:

| Failure or regression | Primary defence | Why this layer |
|---|---|---|
| `src/core` grows an Electron/DOM dependency | Unit boundary test plus lint | The boundary is an import-graph property, not a runtime behavior |
| Chunker, resampler, VAD, or post-processing changes behavior | Core unit tests with synthetic audio and a fake clock | Deterministic and fast; no microphone or OS needed |
| Main, preload, and renderer disagree about IPC payloads | Integration tests against the real preload and IPC validators | Schema validation and the bridge allowlist are app-level contracts |
| Swift helper diverges from its versioned protocol | Contract tests against a fake helper plus Swift XCTest | Hosted CI cannot grant macOS TCC permissions or inject into real apps |
| A model upgrade silently hurts Chinese/mixed quality or latency | ASR benchmark harness | Requires datasets, repeated runs, and machine-specific measurement |
| Audio, transcripts, or keys leak into logs, artifacts, or the network | Privacy tests in unit/integration plus CI artifact checks | Privacy is a product differentiator, not an afterthought |
| Bundle, memory, or final latency creeps release over release | Performance regression harness and trend tracking | Single-run measurements hide tail failures |
| The signed app breaks on a fresh Mac because of permissions | Manual macOS permission checklist | TCC consent UI, Accessibility, and per-app injection are OS-level behaviors |

### Frozen decisions

- Docs-only testing and CI strategy; this card writes no test code.
- Electron/TypeScript stack, the `src/core` boundary, and the deterministic fake ASR first.
- The exact CI provider and E2E framework are recommendations to confirm after the scaffold.
  GitHub Actions is available, a hosted macOS runner can build the Swift helper, and v0.1
  must not depend on paid CI.
- Pre-launch self-review for this card: pass.

### Out of scope

Writing tests or harness code, choosing the default ASR model, packaging, signing,
notarization, the Windows helper implementation, and any change to other documents. Product
requirements for the benchmark are inherited from ASR-RESEARCH.md; this card turns them into
a harness and a CI policy.

## Test Pyramid

The pyramid is about feedback speed and failure ownership, not an arbitrary ratio. Target
shares are a planning guide: roughly 70% of test cases are unit/component tests, 20% are
integration/contract tests, and at most 10% are E2E. Runtime budgets are stricter than case
counts because they determine whether developers run the layer locally.

| Layer | Share of cases | Runtime budget | Runs on | Owns |
|---|---:|---|---|---|
| Unit and component | ~70% | < 60 s local, < 3 min CI | Developer machine and CI | `src/core` logic, renderer components, pure helper logic |
| Integration and contract | ~20% | < 5 min CI | CI (macOS), local | Electron IPC/preload, session state machine, helper protocol, sidecar lifecycle, persistence |
| E2E | ≤ 10% | < 15 min CI | CI (macOS) and local | Menu-bar app flows with fake ASR, fake audio, fake helper |
| Manual OS gates | 0 automated | Release checklist | Signed build on real hardware | macOS permissions, real microphone, real injection, secure fields, Bluetooth |

### Unit tests for `src/core`

`src/core` is plain TypeScript with injected ports, so almost all product logic belongs
here and must run without Electron or a display. Each suite should be deterministic:
fake audio, fake clock, fake provider, no real sleeps, and no network by default.

**ASR provider interface contract suite.** One shared test suite runs against every
provider adapter (local sidecar adapter, cloud adapter with a local stub server, and the
deterministic fake) so a fake cannot drift from the real contract:

- Capability declaration: final-only versus streaming, supported languages, model id.
- Happy path: audio in, final transcript plus provider/model metadata out.
- Cancellation before and during inference; no late result after cancel.
- Typed error taxonomy: timeout, provider unavailable, authentication failure, invalid
  audio, empty result, canceled, internal error. The adapter must not throw raw transport
  errors across the interface.
- Timeout and retry policy; retry only when the adapter declares the error retryable.
- Empty or silent audio returns a typed empty result, never invented text.
- Long utterances: split at VAD silence, hard split before the 30 s SenseVoice limit, and
  no duplicated boundary words.
- Language handling: Chinese, English, and mixed zh/en results preserve the returned
  language tags; the pipeline does not translate or transliterate.
- Partial hypotheses are rejected in v0.1 because the frozen product scope is final-only.

**Audio pipeline.** Tests assert properties, not only golden outputs:

- Resampler: sine-sweep alias check and passband/stopband behavior at 44.1 kHz and 48 kHz
  input, matching the validation gate in AUDIO-PIPELINE.md.
- Ring buffer: 120 s bound, rejection or eviction behavior at the bound, and unreachability
  of finalized audio after zeroing.
- Frame normalization: 16 kHz mono PCM, sequence numbers, timestamps, and handling of a
  short final frame.
- VAD/endpointing: synthetic speech and silence, minimum speech duration, trailing-silence
  confirmation, false-positive characterization on steady noise and tone.
- Chunker: determinism for the same input, overlap size, sequence continuity, and no
  duplicated boundary text.
- Cancellation at every stage; microphone release is not a core concern, but cancel must
  stop downstream work.

**Post-processing.** Punctuation and casing, filler removal, personal vocabulary, and
optional LLM polish are separate composable steps:

- Rule-based steps have table-driven input/output cases, including Chinese punctuation and
  English casing.
- Personal vocabulary replacement respects word boundaries and does not rewrite unrelated
  substrings.
- LLM polish is tested through a fake LLM port with scripted responses; tests assert that
  the step never invents content, never changes the language, and falls back to the
  rule-based result on timeout or invalid output.
- Each step records timing and a step id but never transcript content in metrics.
- Steps compose in the documented order and remain cancellable.

**Model management and settings.** Catalog parsing and schema validation, SHA-256
verification, atomic temp-directory download and rename, resume/cancel, rejection of a
corrupt or partial file, rejection of an arbitrary user-supplied URL, and the transcription
settings schema shared with SpeakPilot.

**Boundary tests.** The import graph is tested, not just reviewed: `src/core` imports no
`electron`, `react`, `react-dom`, DOM globals, helper client, or macOS API. Use an ESLint
restricted-import rule or dependency-cruiser in CI, plus a small Node-environment test that
imports the core entry points with those modules absent. A new core dependency must be
justified as platform-neutral in review.

**Renderer component tests.** The overlay states (idle, recording, transcribing, done,
error), settings forms and validation, permission onboarding copy and deep links, history
opt-in, and error surfaces. Use a DOM environment (jsdom or happy-dom) and React Testing
Library. These tests do not launch Electron; the real Electron shell is covered by E2E.

**Coverage policy.** Coverage is a floor, not a goal. Target at least 85% line and 80%
branch coverage for `src/core`, with 90% changed-line coverage for new core logic. Renderer
coverage is informational. Contract cases and failure paths matter more than a percentage;
a high-coverage suite that only tests the happy path is a failure of this policy. Mutation
testing is a possible later hardening step, not a v0.1 requirement.

**Swift helper unit tests.** Use XCTest through SwiftPM for pure logic: frame
length-prefix parsing, protocol version handling, JSON command decoding, injection decision
logic, and clipboard snapshot/restore state. Do not attempt to unit-test TCC behavior or a
real Accessibility insert; those are manual gates and, later, local integration tests.

### Integration tests for Electron IPC, preload, and the native helper

Integration tests exercise real seams while replacing the OS and provider boundaries with
deterministic fakes. They run in CI on macOS and should not require a microphone,
Accessibility permission, or a network connection.

| Seam | What is real | What is fake | Required cases |
|---|---|---|---|
| Renderer ↔ preload ↔ main | React renderer, preload bridge, IPC handlers, schema validators | ASR, audio, helper, clock | Bridge allowlist, payload validation, sender-frame rejection, subscription cleanup, state events |
| Main ↔ Swift helper | Main-side client, framing, timeout/restart logic | Helper process implementing the versioned protocol | Handshake, version mismatch, partial/oversized frames, sequence gaps, timeout, crash/restart |
| Main ↔ ASR sidecar | Sidecar supervisor and adapter | Scripted sidecar binary or process | Cold start, crash, timeout, empty result, missing/corrupt model, kill on idle |
| Main ↔ cloud provider | Adapter and opt-in gate | Local HTTPS/WebSocket stub | Disabled by default, no key in renderer, redacted errors, explicit fallback only |
| Main ↔ storage | Persistence layer | Temporary directory | Schema validation, atomic writes, history opt-in, no audio retention by default |

**Preload and IPC.** Snapshot the preload surface and fail on any new method that was not
reviewed: only the documented start/stop/cancel, state read, state subscription, settings
open/read/write, and permission-status methods are allowed. Assert that `ipcRenderer`,
`require`, `process`, and a generic `invoke(channel, payload)` are not exposed. On the main
side, test unknown channels, extra fields, wrong types, oversized payloads, and messages
from a non-app sender frame. These tests protect the trust boundary described in
ARCHITECTURE.md; a missing validation is a security regression even if the UI still works.

**Session state machine.** Drive `idle → arming → recording → finalizing → injecting →
done`, plus cancel and error paths. Assert invariants: the microphone is released on every
terminal path, a short or silent utterance returns to idle with a notice, a helper crash
moves to error and offers retry only when the buffer is valid, and no partial history entry
is written when the app quits mid-session.

**Helper protocol contract.** The fake helper is a real child process speaking the
versioned, length-prefixed protocol, not an in-memory mock. This is deliberate: framing,
backpressure, timeouts, and process death are where contract bugs live. Cases: valid
handshake; contract-version mismatch fails closed with a user-visible error; oversized
frames rejected; split frames reassembled; sequence gaps detected; a slow command times out;
the helper crashes and is restarted with state reset; malformed JSON is rejected without a
crash. The same suite must be reusable against the future Windows helper.

**ASR sidecar integration.** A scripted fake sidecar covers lifecycle and failure behavior
that unit tests cannot: launch with an explicit model path, model checksum failure, cold
start, hang, crash, empty output, and kill-on-idle. The fake sidecar never contains real
model weights.

**Cloud adapter integration.** A local HTTP/WebSocket stub proves the adapter, not a vendor
account, is correct. Assert that cloud is disabled until the user selects a provider and
accepts the data notice, that provider errors are redacted, and that there is no silent
cloud failover when the local model fails.

### E2E tests for the menu-bar app

Playwright's Electron support (`_electron.launch()`) launches the real Electron app and can
evaluate in the main process and interact with the first window (E3, Playwright docs). The
API is experimental and supports Electron 21+, so the version is pinned and the suite is
kept small. E2E tests use a test profile that selects the fake helper, fake audio, and
scripted ASR; they never use a real microphone or cloud key.

| E2E flow | CI-safe | Notes |
|---|---|---|
| App launches to the menu bar without showing a main window | Yes | Launch, assert process alive, open settings from the tray |
| Settings open, validate, save, and reload | Yes | Real renderer, preload, IPC, and storage in a temp profile |
| Dictation state sequence with fake ASR | Yes | Start via the test IPC command; assert overlay states and final text |
| Error and retry surfaces | Yes | Scripted fake ASR timeout and helper crash |
| History opt-in and empty state | Yes | Assert no history file when disabled |
| Permission onboarding deep link | Partial | Assert the UI and link target; do not trigger TCC in CI |
| Real global hotkey and push-to-talk | No | Manual or local self-hosted test; depends on OS event tap |
| Real microphone capture and stop flush | No | Manual; depends on device and TCC |
| Injection into a real target app, secure field, clipboard fallback | No | Manual compatibility matrix |
| Packaged `.app` smoke launch | Yes | Launch the unpacked packaged app and assert the bridge works |

E2E tests should assert user-visible outcomes, not internal implementation details. Use
Playwright traces and screenshots only on failure, and make sure they contain no transcript
text or audio. Retries are allowed once to measure flake rate; a test that only passes on
retry is quarantined and fixed, not silently normalized.

### Manual macOS permission tests

These are release-blocking checks on a signed build under a fresh macOS user account. They
cannot be replaced by hosted CI because TCC prompts require a logged-in GUI session,
Accessibility cannot be pre-granted to an arbitrary runner process, and injection behavior
depends on the target application.

| Scenario | Expected behavior |
|---|---|
| First dictation with no microphone permission | Plain-language prompt or explanation, System Settings deep link, no session starts, no crash |
| Microphone denied, then granted in Settings | App recovers without reinstall; next session captures audio |
| Microphone revoked while the app is running | Session ends cleanly, microphone released, actionable notice |
| Accessibility denied | Dictation still transcribes; text goes to the clipboard with a visible notice |
| Accessibility granted | Accessibility insert works in TextEdit and Notes; no double paste |
| Input Monitoring required for push-to-talk | Prompt and deep link; no silent failure if denied |
| Secure input field focused (password manager, browser password field) | No synthetic keystrokes; clipboard-only fallback with a warning |
| Clipboard fallback | Clipboard is snapshotted and restored; a user copy during injection wins |
| Helper crash or hang | Session ends, helper restarts, retry offered when the buffer is valid |
| App restart and sleep/resume | Hotkey and microphone re-register; stale sessions do not survive |
| Device hot-plug and Bluetooth route change | Session ends or warns; no wrong-device capture without notice |
| Target application matrix | Native editors, browsers, terminals, IDEs, Electron apps, self-drawn UIs, secure fields |

Record the macOS version, hardware, app version, signing identity, and target app versions
for every manual pass. The permission checklist is part of the release checklist in
PACKAGING-RELEASE.md, not a separate optional QA step.

## Options

### Test runner: Vitest versus Jest (and Node's test runner)

**Vitest.** Vitest is built around Vite and reuses the Vite config and plugin pipeline;
the landing page reports out-of-box ESM, TypeScript, and JSX support powered by Oxc,
Jest-compatible expect/snapshot/coverage APIs, and watch mode that reruns related tests
(E3, vitest.dev, page shows v5.0.5). For this repository the decisive point is that
electron-vite 6 already uses Vite for main, preload, and renderer builds, so unit and
component tests can share resolution, aliases, and transforms instead of duplicating them.

**Jest.** Jest is mature, widely used, and current (the landing page shows Jest 30.5). It
offers snapshots, coverage, parallel isolated workers, and a large ecosystem, with a
zero-configuration aim (E3, jestjs.io). In a Vite-based project, however, Jest needs its own
transform configuration for TypeScript/ESM and does not reuse the electron-vite pipeline.
The landing page does not document ESM/TypeScript transform details, which is itself a sign
that setup is project-specific.

**Node's built-in test runner.** `node:test` has no extra dependency and is useful for very
small scripts, but its assertion, snapshot, coverage, and React ecosystem is weaker than
either option. It is not selected for the main suite.

**Recommendation:** Vitest for unit and component tests, with separate Vitest projects for
the Node-side core/main code and the DOM-side renderer. Keep Jest as a fallback only if a
required plugin or ecosystem gap appears; the Jest-compatible API keeps migration open.

### E2E and Electron harnesses: Playwright, WebdriverIO, Spectron, Selenium

**Playwright.** Playwright's Electron API launches an app with `_electron.launch({ args })`,
supports `executablePath` for a packaged binary, evaluates in the Electron main process, and
returns the first window for renderer interaction. The documentation labels Electron
support experimental and requires Electron 21 or newer; native dialogs must be replaced in
the main process because they bypass the automation layer (E3, Playwright Electron docs).
The `@playwright/test` runner adds parallelism, retries, traces, screenshots, and CI
reporters.

**WebdriverIO.** Electron's automated-testing guide documents WebdriverIO as a WebDriver-
based option, including connecting to Electron and writing tests. It is a credible fallback
with a larger setup surface and a WebDriver protocol rather than Playwright's in-process
control (E3, Electron automated-testing docs).

**Spectron.** Spectron was deprecated by the Electron team on 2022-02-01; the repository was
archived, the final release was v19.0.0, and the removal of the remote module from Electron
14 made a rewrite necessary (E3, Electron Spectron deprecation notice and archived
repository). It must not be adopted for a new project on Electron 45.

**Selenium + electron-chromedriver.** Electron documents this path, but it requires more
glue and offers lower-level control than Playwright. It is a last-resort compatibility
option, not the default.

**Custom driver over `child_process` and IPC.** Useful for protocol contract tests and for
driving deterministic test commands, but it is not a UI automation framework. This strategy
uses a custom harness for the helper contract and Playwright for UI E2E.

**Note on official guidance.** Electron's guide states that Electron does not actively
maintain its own testing solution and documents several options; it does not declare a
single official recommendation. Playwright is documented there as experimental Electron
support (E3).

### Supporting tools and conventions

- **Swift tests:** XCTest through SwiftPM (`swift test`), with `swift build -c release` for
  the helper binary. UI automation of TCC and injection stays manual.
- **Coverage:** Vitest's V8 coverage provider; upload lcov and a summary, no paid service.
- **Boundary enforcement:** ESLint restricted imports or dependency-cruiser, as already
  required by ARCHITECTURE.md.
- **Fake transport:** a local Node HTTP/WebSocket server for cloud adapters; do not mock
  Electron internals in integration tests.
- **Fixture generation:** deterministic TypeScript or Node scripts with a seeded RNG. The
  implementation belongs to the scaffold card, not this one.
- **CI:** GitHub Actions with pnpm, Node pinned to the Electron-compatible major, macOS
  arm64 runner, and SHA-256 checksums for test artifacts.

## Comparison Matrix

Scores are 1 (worst) to 5 (best), based on the evidence above. Weights reflect the forces in
this document. Scores are the author's judgment, not benchmark results.

### Unit and component runner

| Criterion | Weight | Vitest | Jest | `node:test` |
|---|---:|---:|---:|---:|
| Fit with electron-vite / Vite pipeline | 0.25 | 5 | 3 | 3 |
| TypeScript and ESM out of the box | 0.20 | 5 | 3 | 5 |
| Speed and watch-mode feedback | 0.15 | 5 | 3 | 4 |
| Assertions, snapshots, coverage | 0.15 | 4 | 5 | 2 |
| Ecosystem and maintenance | 0.15 | 4 | 5 | 3 |
| Setup and operational cost | 0.10 | 5 | 4 | 5 |
| **Weighted total** | **1.00** | **4.70** | **3.70** | **3.60** |

### E2E and Electron harness

| Criterion | Weight | Playwright | WebdriverIO | Spectron | Selenium + chromedriver |
|---|---:|---:|---:|---:|---:|---:|
| Electron support today | 0.30 | 4 | 4 | 1 | 3 |
| Reliability and stability of the harness | 0.20 | 4 | 4 | 1 | 3 |
| Debugging artifacts (trace, video, logs) | 0.15 | 5 | 4 | 2 | 3 |
| CI integration and parallelism | 0.15 | 5 | 4 | 2 | 3 |
| Ecosystem and maintenance | 0.10 | 5 | 4 | 1 | 3 |
| Setup and operational cost | 0.10 | 4 | 3 | 3 | 3 |
| **Weighted total** | **1.00** | **4.40** | **3.90** | **1.50** | **2.90** |

Playwright's score reflects experimental Electron support, not a stability claim. That is
why the recommendation includes a fallback and a small E2E suite rather than betting all
coverage on it.

### Layer-to-tool map

| Need | Selected tool | Alternative |
|---|---|---|
| Core unit tests | Vitest (Node project) | Jest |
| Renderer component tests | Vitest + React Testing Library + happy-dom | Jest + jsdom |
| IPC and state-machine integration | Vitest + a real Electron test harness or Playwright Electron launch | WebdriverIO |
| Helper protocol contract | Custom fake-helper process + Vitest | Actual helper with a local runner |
| Swift pure logic | XCTest via SwiftPM | None needed |
| ASR benchmark harness | Standalone Node/TypeScript runner, independent of the unit runner | Python prototype, not for CI |
| Full-app E2E | Playwright `_electron.launch()` | WebdriverIO + electron service |
| Manual OS gates | Release checklist on signed hardware | Local self-hosted automation later |

## Benchmark Harness

The ASR benchmark is an offline, reproducible evaluation that replaces unmeasured estimates
with data before the model ids are locked. It is also the long-term quality gate for model
upgrades. It does not require paid API accounts and does not run as part of every unit-test
run.

### Audio fixtures

Fixture requirements come from ASR-RESEARCH.md. The harness records dataset name, version,
license, and SHA-256 for every fixture; restricted audio stays outside the repository.

| Bucket | Source | Size target | Purpose |
|---|---|---|---|
| Chinese clean | AISHELL-1 test split or a fixed 500-utterance sample, if the license allows evaluation | 500 utterances | Comparable Mandarin CER baseline |
| Chinese in-the-wild | Internal recordings; WenetSpeech subsets only if licensed | 100–300 utterances | Meetings, pauses, disfluencies |
| English clean | LibriSpeech test-clean (CC BY 4.0) | 500–1,000 utterances | Standard WER comparability |
| English noisy/accented | LibriSpeech test-other plus a Common Voice English sample (CC0) | 300–500 utterances | Accent and noise robustness |
| Mixed zh/en | Internal code-switching set | 100–200 utterances | Primary mixed-language evidence |
| Names and technical terms | Curated term list in 50–100 utterances | 50–100 terms | Proper-noun and exact-term recall |
| Noise robustness | MUSAN noise mixed at 5/10/15 dB SNR plus real microphone recordings | 100–200 mixtures | Synthetic and real noise |
| Edge cases | Short utterances (< 1 s), silence, 20–30 s utterances, trailing silence | 50 cases | Chunking, VAD, and segment limits |

Fixed pipeline rules: 16 kHz mono PCM, the same VAD/endpointing, the same post-processing,
the same microphone, and the same room. Record device, transport, sample rate, buffer size,
macOS version, chip, RAM, power state, and cold/warm state. Run each configuration three
times and report median and p95. Local runs use networking disabled to prove the offline
requirement.

### Privacy-safe test data

- **No raw user audio or transcripts** in the repository, CI logs, CI artifacts, benchmark
  result files, or issue reports.
- **Public or redistributable audio** may be referenced by dataset name, version, license,
  and hash. Restricted audio stays outside the repository and is addressed by content hash
  and a local-only path.
- **Internal recordings** require explicit consent, scripted prompts with no personal
  content, and deletion after the benchmark campaign. They are not committed.
- **Synthetic fixtures** (silence, tones, seeded noise, scripted envelopes) are safe to
  commit and are the default for unit and CI tests. Text-to-speech may be used for smoke
  tests but is never evidence of accuracy; TTS artifacts are not a substitute for human
  speech in CER/WER results.
- **Transcripts** are committed only when the dataset license permits redistribution;
  otherwise the harness stores hashes and aggregate metrics only.
- **Metrics are content-free.** The harness must not log recognized text, candidate
  transcripts, or audio. A failure stores the fixture id, metric, and machine profile, not
  the sample.

### Metrics and units

| Metric | Definition | Gate or use |
|---|---|---|
| Chinese CER | Character error rate after text normalization (punctuation removed, digits and Latin tokens normalized consistently) | ≤ 8% clean, ≤ 15% noisy (proposed thresholds from ASR-RESEARCH.md) |
| English WER | Word error rate after lowercasing and punctuation removal | ≤ 8% clean, ≤ 15% noisy (proposed) |
| Mixed-language error | Per-utterance error, with separate Chinese-span and English-span errors | ≤ 15% overall, no span above 25% (proposed) |
| Proper-noun / term recall | Exact and normalized match on the curated term list | ≥ 85% before vocabulary post-processing (proposed) |
| Final latency | Stop/end-of-speech to final post-processed text, p50 and p95, for 5 s, 10 s, and 30 s utterances | p50 < 1.5 s, p95 ≤ 3 s for 10 s utterances on the base Apple Silicon machine |
| ASR inference latency | ASR start to ASR result | p50 ≤ 1.2 s, p95 ≤ 2.5 s (AUDIO-PIPELINE.md) |
| RTF | Ambiguous across teams. Record both `rtf = inference_seconds / audio_seconds` (lower is better) and `speed_factor = audio_seconds / inference_seconds` (higher is better) | Label the reported form; never compare across conventions. ASR-RESEARCH.md currently states the speed-factor form, so the harness must make that explicit. |
| Cold start | Sidecar launch to model ready, first run and warm run | ≤ 2 s after the binary is warm on disk (ASR-RESEARCH.md) |
| Peak RSS | Sidecar and app during inference | Sidecar ≤ 2 GB (ASR-RESEARCH.md); app budget tracked separately |
| Model size on disk | All model files, not just the main checkpoint | Default download ≤ 1 GB; installed models ≤ 2 GB |
| Stability | Crashes, timeouts, empty outputs, and repeated-run variance | No crashes or timeouts across the evaluation set |

### Harness mechanics

- **Runner:** a standalone Node/TypeScript harness under a future `bench/` directory,
  independent of the unit-test runner. It loads a fixture manifest, drives the real local
  provider through the core pipeline, and writes one JSON result per run.
- **Result schema:** run id, git commit, app version, provider/model id, model SHA-256,
  runtime and version, dataset versions and hashes, machine profile, power state, metric
  values, pass/fail per hard gate, and free-form notes. No audio or transcript content.
- **Where results live:** `bench/results/<date>-<commit>.json` in the repository if the
  numbers are not sensitive, or as a CI artifact plus a compact summary. The point is that a
  historical series exists; the storage location is an implementation detail.
- **Cadence:** a smoke benchmark (about 20 utterances, latency and crash checks) can run on
  a schedule or before a performance-sensitive change; the full benchmark runs before model
  lock, weekly on a maintained machine, and for every release candidate. Full benchmark
  results are not required on every pull request because hosted-runner variance would make
  the gate noisy.
- **Decision rule:** a candidate that fails any hard gate is not the default. Quality and
  latency results are compared candidate by candidate, with the winning configuration,
  model checksums, runtime version, and hardware recorded. The benchmark unlocks the final
  model decision; it does not silently change the local-first privacy default.

## CI

### Provider and runtime baseline

- **Provider:** GitHub Actions, using a standard macOS runner. Standard GitHub-hosted
  runners are free for public repositories; larger or billed runners are not used because
  v0.1 must not depend on paid CI (E3, GitHub Actions billing and runner documentation).
  If Actions becomes unsuitable, PACKAGING-RELEASE.md's no-paid-CI fallback applies: the
  same commands run locally on a maintained macOS build machine.
- **Runner image:** pin a standard arm64 macOS image from the `actions/runner-images`
  README rather than using an unversioned `-latest` label, so Xcode and Swift versions do
  not change under the build. The image must include Xcode and the Swift toolchain for the
  helper. Do not use `macos-*-large` or `-xlarge` labels for routine CI; they are billed.
- **Node:** pin the Node major that Electron 45 bundles, so native tooling and test
  behavior match the runtime. The exact bundled major must be read from Electron 45's
  release metadata, not guessed. Node 24 LTS is the working candidate for the toolchain; if
  Electron 45 reports a different major, use that major. Encode the decision in `.nvmrc`,
  `engines`, and the `packageManager` field, and use the same major locally and in CI.
- **Package manager:** pnpm, activated through Corepack with a pinned `packageManager`
  version. Use `pnpm install --frozen-lockfile`; never an unpinned install. Note:
  PACKAGING-RELEASE.md currently says `npm ci` in its release steps. That inconsistency must
  be resolved before the scaffold; this document recommends pnpm and lists the document
  update as an open question.
- **Caching:** cache the pnpm store keyed on `pnpm-lock.yaml`, the Electron binary cache
  keyed on the Electron version, and the SwiftPM `.build` directory keyed on
  `Package.resolved` plus the Xcode/Swift version. Do not cache `node_modules`, test
  results, or coverage output.

### Jobs

| Job | Runner | Steps | Gate |
|---|---|---|---|
| `verify` | macOS arm64 | Checkout; setup Node and pnpm; restore caches; `pnpm install --frozen-lockfile`; typecheck; lint and boundary checks; unit and component tests with coverage; `pnpm build`; upload coverage and logs | Required for every pull request and on `main` |
| `swift-helper` | macOS arm64 | `swift build -c release`; `swift test` if XCTest targets exist; compute SHA-256 of the helper; upload the helper artifact | Required as soon as the helper exists |
| `e2e` | macOS arm64 | Restore caches; install; download or build the unpacked app and fake helper; run Playwright Electron E2E with the test profile; upload traces and screenshots on failure only | Required after the app shell exists; 20-minute timeout |
| `package-smoke` | macOS arm64 | Build an unpacked app with electron-builder; launch it; verify version and bridge; compute SHA-256 | Optional early, required before the first beta |
| `windows-later` | Windows runner | Typecheck, unit and contract tests against the fake helper; build; add the native helper job when the Windows helper exists | Added with the Windows helper, not before |

The `verify` job runs typecheck, unit tests, and build on macOS in one job for simplicity;
the core is platform-neutral, so a later Ubuntu mirror can speed up feedback if CI minutes
become a constraint. Do not split typecheck and unit tests into separate jobs until the
workflow is stable; extra jobs add queue latency and duplicate installs.

### Artifact checksums and supply-chain checks

- Compute SHA-256 for the Swift helper binary, the unpacked test app, and the fixture
  manifest. Emit a `SHA256SUMS` file next to the test artifacts and verify hashes in any
  downstream job that consumes them.
- Verify downloaded model files against the catalog SHA-256 before use. Benchmark and
  integration tests use local stub files with known hashes; they never download a model
  from an unpinned URL.
- The release workflow inherits its artifact and checksum rules from PACKAGING-RELEASE.md
  (DMG, ZIP, `latest-mac.yml`, `SHA256SUMS`, SBOM, license bundle). The testing workflow
  does not sign or notarize; it only proves the build and tests pass.
- Pin third-party actions by full commit SHA, set `permissions: contents: read` by default,
  and never expose signing or publishing secrets to pull-request workflows. Use a protected
  environment for release jobs, as PACKAGING-RELEASE.md already requires.
- Add `concurrency` cancellation per ref so a superseded pull request does not consume a
  full macOS job. Keep artifact retention short for test artifacts; keep benchmark results
  longer because they are the trend series.

### CI privacy and test hygiene

- Unit tests run with network access disabled by default; cloud adapter tests opt in to a
  local stub server explicitly.
- Tests fail if they write outside a temporary directory or if a log line matches a
  transcript-like fixture marker. This is a guardrail, not a substitute for code review.
- E2E artifacts contain no audio or transcript text. When a failure needs a transcript to
  debug, use a synthetic fixture whose content is already public.
- Manual permission results are recorded in the release checklist with macOS version,
  hardware, and signing identity; they are not encoded as flaky CI assertions.

### Windows later

When the Windows helper exists, add a Windows job with the same pnpm commands, typecheck,
unit tests, contract tests against the fake helper, and the native helper build. Until then,
the helper contract suite must remain platform-neutral and should be runnable on Windows
against the fake helper, as WINDOWS-PORT.md requires. Do not add Windows packaging to CI
before the helper exists, and do not make a paid Windows runner a dependency.

## Performance Regression

Performance gates are split into frozen targets inherited from the design documents and
provisional budgets that must be replaced by measurement after the first release-class
build. A gate that is not measured is not a gate.

| Budget | Threshold | Status | Source |
|---|---|---|---|
| Hotkey to recording indicator | ≤ 100 ms | Frozen | ARCHITECTURE.md |
| Hotkey to first PCM frame | p50 ≤ 150 ms, p95 ≤ 400 ms | Frozen (spike gate) | AUDIO-PIPELINE.md |
| Stop to last PCM frame | p95 ≤ 80 ms | Frozen (spike gate) | AUDIO-PIPELINE.md |
| Stop to final transcript (10 s utterance, local provider, base Apple Silicon) | p50 ≤ 1.5 s, p95 ≤ 3 s | Frozen | ARCHITECTURE.md, ASR-RESEARCH.md |
| ASR inference (10 s utterance) | p50 ≤ 1.2 s, p95 ≤ 2.5 s | Frozen | AUDIO-PIPELINE.md |
| Rule-based post-processing | ≤ 150 ms | Frozen | AUDIO-PIPELINE.md |
| Optional LLM polish | ≤ 800 ms, opt-in | Frozen | AUDIO-PIPELINE.md |
| Final text to injection acknowledged | ≤ 100 ms | Frozen | ARCHITECTURE.md |
| Stop to text at cursor | p50 ≤ 1.6 s, p95 ≤ 3.1 s | Derived | AUDIO-PIPELINE.md |
| Cancel to microphone released | ≤ 100 ms | Frozen | ARCHITECTURE.md |
| Sidecar peak RSS | ≤ 2 GB | Frozen gate | ASR-RESEARCH.md |
| Default model download / total installed models | ≤ 1 GB / ≤ 2 GB | Frozen gate | ASR-RESEARCH.md |
| Cold start (warm binary) | ≤ 2 s | Frozen gate | ASR-RESEARCH.md |
| App RSS, idle / recording | ≤ 500 MB / ≤ 800 MB | **Provisional**; replace with measured baseline + 10% | ADR-0002 leaves the app RSS budget open; these are planning ceilings |
| macOS DMG (arm64, excluding models) | ≤ 200 MB | **Provisional**; replace with measured baseline + 5% | ADR-0002 measured competitor DMGs at 104–314 MB; JustSpeak should ship smaller |
| Installed app (excluding models) | ≤ 300 MB | **Provisional** | Derived from the DMG ceiling |
| Session-over-session RSS growth | ≤ 10% after buffer zeroing | Frozen leak check | AUDIO-PIPELINE.md memory-hygiene requirement |

### Measurement methodology

- Use a monotonic clock and the timestamp points already defined in AUDIO-PIPELINE.md:
  `t_hotkey`, `t_start_cmd`, `t_first_frame`, `t_stop`, `t_last_frame`, `t_vad_end`,
  `t_asr_start`, `t_asr_done`, `t_post_done`, `t_inject_ack`, `t_mic_released`.
- Report p50 and p95 over at least 50 utterances per configuration, separated by 5 s, 10 s,
  and 30 s durations. A fast p50 with a long tail is a user-visible failure; p95 is the
  release gate.
- Exclude the first-run TCC prompt and model download from steady-state numbers, but report
  them separately as onboarding latency. Record cold versus warm state explicitly.
- Run on the same machine profile, power state, and runner image when comparing numbers.
  Never compare an arm64 hosted runner with an Intel laptop or a fanless Mac under thermal
  throttling.
- Run each performance configuration three times and use the median and p95. Do not publish
  a single best run as evidence.

### Trend tracking

- Store one JSON record per benchmark or performance run, keyed by commit and machine
  profile, under `bench/results/` or as a CI artifact with a compact summary. The series is
  the regression signal, not a single number.
- Define the rolling baseline as the median of the last 10 runs on `main` for the same
  machine class. Flag a regression when p95 latency rises more than 10%, RSS rises more
  than 10%, or the DMG/installed size rises more than 5% against that baseline.
- Run the full benchmark weekly and for every release candidate; compare release candidates
  against the previous release tag. Keep a short human-readable summary per release in the
  release notes or changelog, without transcript or audio content.
- If hosted-runner variance for a metric exceeds 10%, make that metric informational in CI
  and move the gating run to a maintained self-hosted or local machine. Do not loosen a
  product gate just to make CI green.
- Bundle size and checksums are checked on every packaged build; a size change requires a
  note in the pull request explaining what grew and why.

## Fixtures and Mocks

The default test posture is fake-first: deterministic fakes cover the provider, audio,
time, injection, helper, sidecar, and network boundaries. Real implementations are exercised
by a small number of contract and manual tests.

| Fake | Behavior | Used by |
|---|---|---|
| `FakeAsrProvider` | Returns scripted final text keyed by fixture id; supports configurable delay, cancellation, timeout, empty result, and typed failure modes; deterministic given a seed | Core unit tests, integration, E2E |
| Fake audio | Generates 16 kHz mono PCM: silence, tone, seeded noise, scripted speech-like envelopes, and exact 5/10/30 s clips; includes a sine-sweep fixture for the resampler | Core unit tests, E2E |
| Fake clock | Injected monotonic clock; advances explicitly; no real sleeps | Unit and integration |
| Fake injector | Records text, target context, and chosen path; simulates Accessibility success, clipboard fallback, secure field, and partial failure | Core/app integration, E2E |
| Fake helper | A real child process speaking the versioned length-prefixed protocol; modes for version mismatch, partial/oversized frames, slow response, crash, and restart | Helper contract tests, integration, E2E |
| Fake sidecar | A scripted process with modes for cold start, hang, crash, empty output, and missing/corrupt model | Sidecar integration |
| Fake cloud transport | Local HTTP/WebSocket stub with scripted responses and errors; explicit opt-in per test | Cloud adapter tests |
| Fake ports | Temporary filesystem, fetch/WebSocket stub, Keychain stub | Core and main integration |

Rules for fixtures:

- **No raw user data.** Never commit a real recording, a real transcript, or a real
  conversation. Synthetic fixtures and redistributable public samples only.
- **Deterministic seeds.** Fixture generators take a seed and produce byte-identical output.
  A test that depends on randomness without a seed is a bug.
- **Manifest everything.** Every fixture records its purpose, license, SHA-256, and the
  layer that may use it. Benchmark-only fixtures are not loaded by unit tests.
- **Golden files are reviewed.** Post-processing input/output pairs are checked in and
  changes to them appear in the diff; do not blind-update snapshots in CI.
- **No network by default.** Unit tests and core integration tests fail if they attempt a
  network call. Cloud tests opt in to a local stub.
- **Version the fakes.** A fake provider implements the same interface version as the real
  adapter, and the shared contract suite is the source of truth. When the interface changes,
  the fake and the real adapters fail together.

Privacy tests are part of the regular suite, not a one-off review: logs contain no
transcript text, no network call occurs with cloud disabled, audio buffers are cleared after
finalization, and history is not written unless the user enabled it.

## Recommendation

Adopt the following for v0.1:

1. **Vitest** for unit and component tests, with two projects: Node-side core/main tests and
   DOM-side renderer tests. Keep Jest as a fallback only if a blocking ecosystem gap appears.
2. **Playwright (`@playwright/test`) with `_electron.launch()`** for a small E2E suite. Treat
   Electron support as experimental; pin the Playwright version, keep the suite focused on
   user-visible flows, and use WebdriverIO's Electron service as the fallback if Playwright's
   Electron API blocks the app shell.
3. **Fake-first integration:** deterministic fake ASR, fake audio, fake injector, fake
   helper, fake sidecar, and fake clock. Real Swift behavior is covered by XCTest for pure
   logic and by the manual macOS permission checklist for OS integration.
4. **A first-class ASR benchmark harness** with the fixture buckets, privacy rules, CER/WER,
   latency, RTF, memory, model-size, and cold-start measurements defined above. Use the hard
   gates from ASR-RESEARCH.md; label RTF conventions explicitly.
5. **GitHub Actions on a standard macOS arm64 runner**, Node pinned to Electron 45's bundled
   major, pnpm with a frozen lockfile, caches for pnpm/Electron/SwiftPM, and required jobs
   for typecheck, unit tests, build, Swift helper, and E2E. Add Windows later, contract-first.
6. **Performance gates with p95 as the release criterion**, a rolling baseline, the frozen
   latency/memory/model gates, and provisional app-RSS and bundle ceilings that must be
   replaced by measurement after the first release-class build.
7. **A release-blocking manual macOS permission checklist** on a signed build, covering
   microphone, Accessibility, Input Monitoring, secure fields, clipboard fallback, device
   changes, helper crashes, and the target application matrix.

### Sequencing

1. Before the first feature code: scaffold the test projects, the fake provider, the fake
   helper, and the required CI checks. The core contract and boundary tests come with the
   first core code, not later.
2. After the app shell exists: add the minimal Playwright E2E flows and the packaged smoke
   test.
3. Before the model decision: run the full benchmark and record results with checksums and
   hardware. Do not lock the default model on estimates.
4. Before the first signed beta: run the manual permission checklist and record evidence.
5. At every release candidate: rerun unit/integration/E2E, the smoke benchmark, bundle and
   memory checks, and the permission checklist.

### Revisit triggers

- Playwright's Electron support becomes blocked or unstable; switch to WebdriverIO.
- Vitest hits a blocking plugin or coverage gap; reassess Jest.
- Hosted-runner variance makes a performance gate unreliable; move that gate to a maintained
  machine.
- The Windows helper lands; add the Windows CI job and run the contract suite natively.
- The benchmark shows a model that changes the latency or memory assumptions; update the
  hard gates through the ASR decision card.
- The package-manager decision changes; update CI and PACKAGING-RELEASE.md together.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Playwright's experimental Electron API breaks on an Electron upgrade | Medium | Medium | Pin Playwright and Electron; keep E2E small; retain WebdriverIO as a tested fallback |
| Hosted macOS runners cannot reproduce mic, TCC, or injection behavior | High | High | Fake-first CI; release-blocking manual checklist on signed hardware; consider a self-hosted Mac later |
| Performance gates are flaky because of runner variance | High | Medium | Three runs, medians, same runner image, p95 gates, move gating to a maintained machine if variance exceeds 10% |
| Fakes drift from real ASR adapters | Medium | High | One shared contract suite for every adapter; periodic real-model smoke run |
| Benchmark overfits public datasets | Medium | Medium | Held-out in-the-wild and term sets; do not tune against the public test split |
| Privacy leak through fixtures, logs, or artifacts | Medium | High | Synthetic/public fixtures only; content-free metrics; CI artifact checks; redaction review |
| Package manager inconsistency (pnpm here, `npm ci` in PACKAGING-RELEASE.md) | High | Low | Decide before scaffold; update the packaging document in a separate docs change |
| CI cost or runner availability changes | Low | High | No paid-CI dependency; local release fallback from PACKAGING-RELEASE.md |
| Coverage theater: high percentages, weak failure-path coverage | Medium | Medium | Contract cases, failure paths, and changed-line coverage; no global percentage target |
| E2E flake hides real regressions | Medium | Medium | One retry to measure flake rate; quarantine and fix; no blind reruns |
| TCC identity differs between development and signed builds | High | Medium | Permission checklist runs on the signed build; stable bundle id and signing identity |
| Swift toolchain or Xcode changes under CI | Medium | Medium | Pin the runner image and Xcode; cache SwiftPM; record tool versions in failure logs |

## Decision Status and Pre-Launch Self-Review

**Status:** Proposed. The tooling choices are recommendations to confirm at scaffold time,
as the frozen card requires. The test layers, privacy rules, benchmark gates, and manual
permission checklist are the durable parts of this strategy; the exact runner versions and
CI labels are implementation details.

**Pre-launch self-review:** passed for this docs-only card. The document writes no test
code, installs nothing, runs no tests, and does not claim measured benchmark results. Every
inherited numeric target is attributed to its source document; the only new numeric ceilings
(app RSS and bundle size) are labeled provisional. The required headings and checklist items
are present.

## Open Questions

1. **Node major:** which Node version does Electron 45 bundle? Read it from the Electron 45
   release metadata and pin CI to that major; the current candidate is Node 24 LTS.
2. **Package manager:** pnpm (this document) versus `npm ci` (PACKAGING-RELEASE.md). Resolve
   before the scaffold and update the losing document.
3. **E2E framework:** confirm Playwright's Electron API is sufficient for the menu-bar shell,
   or choose WebdriverIO's Electron service. Decide after the app-shell spike.
4. **Self-hosted macOS runner:** is a maintained Mac required for real TCC/injection E2E, or
   is the manual checklist sufficient for v0.1?
5. **App RSS and bundle ceilings:** what are the measured idle/recording RSS and DMG size
   after the first release-class build? Replace the provisional ceilings with those numbers.
6. **Benchmark hosting:** where do restricted internal recordings live, who approves their
   use, and when are they deleted?
7. **Intel Mac support:** is an x64 CI runner or local Intel test machine required, or is
   Intel explicitly unsupported in v0.1?
8. **Coverage thresholds:** are 85% line / 80% branch for `src/core` the right floors after
   the first implementation? Should mutation testing be added later?
9. **Benchmark cadence on CI:** can a smoke benchmark run reliably on hosted macOS runners,
   or should all performance measurement stay on a maintained machine?
10. **Windows CI timing:** when the Windows helper exists, which runner image and native
    toolchain are pinned, and does the contract suite run on Windows before the helper?
11. **Flake policy:** what is the quarantine window for an E2E test that only passes on
    retry, and who owns it?
12. **Required checks and branch protection:** which jobs are required on `main` before the
    scaffold stabilizes?

## Sources

### E2 — repository design documents inspected

- [ADR-0001: Core boundary and repository strategy](ADR-0001-core-boundary.md)
- [ADR-0002: Technology stack for JustSpeak v0.1](ADR-0002-tech-stack.md)
- [ARCHITECTURE.md](ARCHITECTURE.md) — process model, boundary enforcement, testing strategy,
  latency targets, failure handling.
- [ASR-RESEARCH.md](ASR-RESEARCH.md) — benchmark datasets, metrics, hard gates, model
  distribution, privacy-safe evaluation rules.
- [AUDIO-PIPELINE.md](AUDIO-PIPELINE.md) — capture path, VAD/chunking validation gates,
  latency budget, memory-hygiene requirements.
- [TEXT-INJECTION-HOTKEYS.md](TEXT-INJECTION-HOTKEYS.md) — injection paths, hotkey options,
  focus context, failure modes.
- [PACKAGING-RELEASE.md](PACKAGING-RELEASE.md) — artifact formats, checksums, release
  checklist, CI secrets, no-paid-CI fallback.
- [WINDOWS-PORT.md](WINDOWS-PORT.md) — Windows testing matrix and contract-first port rules.

### E3 — web and third-party documentation verified

- Vitest (page shows v5.0.5; Vite-native, Oxc-powered TS/ESM/JSX, Jest-compatible APIs,
  related-test watch mode): <https://vitest.dev/>
- Jest (page shows Jest 30.5; snapshots, coverage, parallel isolated workers, minimal
  configuration aim): <https://jestjs.io/>
- Playwright Electron API (experimental, Electron 21+, `_electron.launch()`,
  main-process evaluate, first window, native-dialog limitation):
  <https://playwright.dev/docs/api/class-electron>
- Electron automated testing guide (WebdriverIO, Selenium + electron-chromedriver,
  Playwright experimental, custom driver; no single official recommendation):
  <https://www.electronjs.org/docs/latest/tutorial/automated-testing>
- Spectron deprecation notice (deprecated 2022-02-01, archived, final v19.0.0):
  <https://www.electronjs.org/blog/spectron-deprecation-notice>
- Spectron archived repository: <https://github.com/electron-userland/spectron>
- WebdriverIO Electron service (documented by the Electron testing guide):
  <https://webdriver.io/> and
  <https://github.com/webdriverio-community/wdio-electron-service>
- GitHub Actions documentation: <https://docs.github.com/en/actions>
- GitHub-hosted runner images and labels: <https://github.com/actions/runner-images>
- GitHub Actions billing and free standard runners for public repositories:
  <https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions>
- GitHub Actions dependency caching:
  <https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows>
- pnpm: <https://pnpm.io/> ; Corepack: <https://nodejs.org/api/corepack.html>
- Swift Package Manager: <https://www.swift.org/documentation/package-manager/>
- XCTest: <https://developer.apple.com/documentation/xctest>
- Test pyramid background (Martin Fowler):
  <https://martinfowler.com/articles/practical-test-pyramid.html>
- Google testing blog, test sizes:
  <https://testing.googleblog.com/2010/12/test-sizes.html>
- Playwright test runner: <https://playwright.dev/docs/test-intro>

The seeded links from the task card were checked: Vitest, Jest, the Playwright Electron
page, the Electron automated-testing page, and the GitHub Actions documentation all resolve
and support the claims above. The Vitest, Jest, and Playwright pages report versions at the
time of access; those versions are recommendations to pin, not guarantees about future
releases.
