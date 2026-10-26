# Privacy and Security Design for JustSpeak v0.1

- Status: Accepted design baseline for v0.1; hardening items marked "later" are not
  v0.1 implementation commitments.
- Date: 2026-10-26
- Decision owner: FD2008
- Depends on: [ADR-0001: Core boundary](ADR-0001-core-boundary.md),
  [ADR-0002: Technology stack](ADR-0002-tech-stack.md),
  [ARCHITECTURE.md](ARCHITECTURE.md), [ASR-RESEARCH.md](ASR-RESEARCH.md),
  [AUDIO-PIPELINE.md](AUDIO-PIPELINE.md),
  [TEXT-INJECTION-HOTKEYS.md](TEXT-INJECTION-HOTKEYS.md),
  [LLM-POSTPROCESSING.md](LLM-POSTPROCESSING.md), [PRIVACY.md](PRIVACY.md),
  [SECURITY.md](../SECURITY.md)
- Scope: data inventory, competitor observation, privacy alternatives, threat model,
  security controls, consent/privacy-policy requirements, and the v0.1 recommendation.
  This document contains no code, packages, or security-tool runs.
- Evidence tags: **E2** = primary code/config/artifact inspected directly for this
  document (project design docs, manifests, license text). **E3** = web/third-party
  documentation, reverse engineering, or privacy audits. Typeless claims are E3 because
  they come from third-party analysis of a shipped build, not from source code. Access
  date: 2026-10-26.

## Summary

JustSpeak v0.1 is a local-first dictation app. The privacy promise is not "we collect
less"; it is "the default path has no network and no content capture". The user presses a
hotkey, speaks, and the app transcribes on device, cleans the text with deterministic
rules, and injects it into the focused application. Cloud ASR, cloud LLM cleanup,
selected-text context, history, telemetry, and crash upload are separate opt-in features,
each with its own consent, data notice, and off switch.

This document recommends **Option B (minimal context) for v0.1**, evolving toward
**Option C (opt-in context)** only after measured quality evidence and a privacy review.
The Typeless-like full-context model is documented as the competing design and is
explicitly **not** the v0.1 default.

The three load-bearing rules are:

1. **Local-first.** No audio, transcript, selected text, or app context leaves the device
   unless the user enables a specific cloud feature for that purpose.
2. **Context off by default.** v0.1 captures only the frontmost app name, bundle id, pid,
   focus state, and the narrow secure/editable flags required for safe injection. Those
   values stay local. No window title, URL, input content, selection, surrounding text,
   screen text, clipboard content, or keystroke history is collected.
3. **Every network destination is documented, and telemetry is off by default.** The app
   must be able to run with the network disabled after model download; a privacy test
   asserts that no network call occurs when optional features are off.

## Data Inventory

The inventory separates what v0.1 processes by default from data that is only possible
behind an opt-in feature. "Not collected" is a product commitment, not an implementation
gap.

| Data | Source | v0.1 default | Destination / storage | Retention | Sensitivity |
|---|---|---|---|---|---|
| **Microphone audio** | Renderer `getUserMedia` + AudioWorklet (AUDIO-PIPELINE) | Captured in memory as 16 kHz mono PCM; VAD/endpointing in `src/core`; local ASR by default | Memory only; zeroed after finalization; no disk write | Session only; bounded at 120 s of audio | High |
| **Transcripts** | Local ASR result; rule-based cleanup | Processed locally; injected into the focused app; history is opt-in and local | Main process memory; optional local history DB; optional cloud LLM only if enabled | Session only by default; opt-in history follows retention setting | High |
| **User edits / corrections** | User edits to history text; explicit personal-dictionary edits | No automatic learning from edits; dictionary edits are explicit and local | Local settings/history only; never uploaded as a training signal | User-controlled | High |
| **App name, bundle id, pid, focus state** | Swift helper (`NSWorkspace`) | Collected locally for safe injection, per-app policy, and diagnostics | Main process memory; not persisted in history; never in telemetry | Session only | Medium |
| **Window title** | Accessibility API / `CGWindowListCopyWindowInfo` | **Not collected** in v0.1; window titles require Accessibility or Screen Recording | — | — | High |
| **URL / browser domain** | Accessibility / browser context | **Not collected** in v0.1 | — | — | High |
| **Focused input content** | Accessibility (`AXValue`, selected range) | **Not collected** as content; only the secure/editable flags needed to avoid password fields | Flags only, session memory | Session only | High |
| **Selected text** | Accessibility or simulated copy | **Not collected** in v0.1; later opt-in, explicit action, 500-character cap | Not sent anywhere unless the user enables selected-text context for a specific request | Per request | High |
| **Surrounding text** | Accessibility (`before`/`after` cursor) | **Not collected** in v0.1; later opt-in with proposed 300 + 300 character caps and a 2,000-character total cap | Local only by default; if cloud cleanup is enabled, only the bounded excerpt the user previewed | Per request | High |
| **Screen-visible text** | Accessibility tree traversal or OCR | **Never** in v0.1; no Screen Recording permission; no screenshots; no OCR | — | — | Very high |
| **Clipboard** | `NSPasteboard` for injection snapshot/restore | Transcript is written transiently and restored; clipboard is read only to restore the user's prior items, never for context | `NSPasteboard.general`; optional clipboard-manager history (outside our control) | Seconds; not logged | High |
| **Keyboard events** | Electron `globalShortcut` / optional helper event tap | Only the configured hotkey is observed; no general keylogging | Main process / helper; no persistence | Session only | Medium (hotkey) / High (general keys) |
| **Telemetry / metrics** | Main process counters | **Off by default**; if enabled, content-free fields only (duration, provider id, model id, latency, error class, app version, OS version) | Exact provider is a later decision; no provider in v0.1 | Opt-in; short retention, defined in policy | Low |
| **Crash reports** | OS crash reporter / app crash handler | Local-only by default; no automatic upload; upload requires explicit consent and preview | Local diagnostics directory; optional provider later | Until user deletes or opts in | High (memory can contain transcript/audio) |
| **Settings, dictionary, API keys** | User input | Settings and dictionary local; API keys in Keychain / `safeStorage` | Local app-support directory; Keychain | Until deleted by user | Low (settings) / High (keys, dictionary) |
| **Logs** | Main process structured logger | Content-redacted; no transcript, audio, selection, URL, or app content | Local log file; rotation and deletion | Bounded; user-deletable | Low by design |
| **Downloaded models** | Model catalog | Public model weights; SHA-256 verified before load | Local model directory with least-privilege permissions | Until deleted or re-downloaded | Low (integrity-sensitive) |

### Inventory notes

- **"Context" is not one feature.** App identity, selected text, surrounding text, visible
  text, and URL have different privacy costs and different quality benefits. The product
  must not bundle them into a single "improve accuracy" toggle.
- **Window title and URL are excluded because they are high-signal surveillance data.**
  A title can contain a document name, a customer name, a patient name, or a private
  message. A URL can contain search terms and tokens. v0.1 neither needs them nor asks
  for the permissions that expose them.
- **Screen-visible text is a hard boundary.** It is not in v0.1, it is not in the v0.2
  roadmap by default, and the app does not request Screen Recording. If a future feature
  ever needs it, it requires a new privacy design, a new consent flow, and a visible
  recording indicator.
- **The clipboard is a transport, not a data source.** It is used because clipboard +
  `Cmd+V` is the most compatible injection path (TEXT-INJECTION-HOTKEYS). It is not read
  to infer context, and it is not used to synthesize a copy of selected text in v0.1.
- **Crash dumps are the most under-estimated leak.** A native crash can capture heap or
  stack memory containing transcript text, audio buffers, or API keys. "Crash reporting"
  must therefore default to local-only and require explicit preview before upload.

## Typeless: Observed Approach (E3)

This section records what third-party analysis and privacy audits observed in a shipped
Typeless build. It is evidence for design comparison, not an accusation and not a
template. All Typeless claims below are **E3** with medium-high confidence for static
analysis and packet capture, and lower confidence for inference about server behavior.

### Cloud-only processing

- The client records, compresses, and collects context; **ASR and text cleanup run
  server-side** (E3, `00-overview.md`). The client sends 3-second Opus chunks over
  WebSocket and uses an HTTP fallback; the finished text arrives after the audio is
  complete (observed 1.4–1.9 s after stop for utterances up to 13 s).
- The network destinations observed are the vendor API host (`api.typeless.com`), a
  WebSocket audio/context channel, an HTTP fallback, remote configuration/blacklist
  endpoints, and `/user/traits` for edit learning (E3, `00-overview.md`,
  `06-context-capture-and-privacy.md`).
- The client does not return partial transcript text during recording; the server
  acknowledges chunks only (E3).

### Context capture

At dictation start and during recording, the client collects and sends an `audio_context`
payload (E3, `06-context-capture-and-privacy.md`):

| Group | Observed fields | Observed limits / behavior |
|---|---|---|
| Device environment | OS version, architecture, CPU cores, memory, locale, region, device model, system uptime | Sent on every dictation |
| Active application | App name, bundle id, window title, window position/size, app type, process id, app path, window number | Window titles and positions are included |
| Browser context | Page title, URL, domain | Only for recognized browsers |
| Visible screen text | Text from the window's accessibility tree | Up to **10,000 characters**; observed 10,003 with truncation marker in iTerm2 |
| Input insertion point | Input area type, accessibility role, position, editability/Markdown/DOM metadata | Captured for the focused element |
| Cursor state | Cursor position, selected text, text before cursor, text after cursor, full field content | Observed **5,000 characters before the cursor** in a terminal |
| Surrounding context | Text before/after the input field | Up to **1,000 characters each** |
| Metadata | Capture version, own-app flag, timestamp, capture frequency, total duration, blacklist status, per-step quality/errors | Server receives per-step success/failure |

Capture timing (E3):

- **Every 1 second**, the app polls app/input basics; this runs from app launch, not only
  during dictation.
- **At recording start**, it captures app, input element, and cursor state, and sends a
  lightweight context with `start_audio`.
- **During recording**, it captures the full context including visible text and
  surrounding content; each text capture has a 500 ms timeout, and the heavier context is
  sent via `replace_audio_context`.
- **After insertion**, it performs a full capture, then reads the input field once per
  second for up to ~15 seconds and uploads `refined_inserted_text`,
  `original_input_box`, `edited_input_box`, app info, device info, and mode to
  `/user/traits`; the server may auto-add dictionary terms. This is the "learns from your
  corrections" mechanism (E3).

The measured examples are the strongest privacy evidence in the public record: a terminal
dictation uploaded 5,000 characters before the cursor, 10,003 visible characters, and 985
characters of surrounding text in 109 ms — including whatever secrets were printed in the
terminal. A chat-app session uploaded 3,741 visible characters and 541 characters before
the input field (E3, four captured sessions).

### Blacklists

The client ships an app/URL blacklist and whitelist and can fetch updates from a remote
endpoint (E3, `06-context-capture-and-privacy.md`):

| Type | Observed macOS entries |
|---|---|
| App blacklist | Sublime Text 4, WeChat, Excel, WPS, Zed |
| App whitelist | Cursor, Slack, Apple Mail, Figma, ChatGPT Atlas, Conductor, WezTerm, Thunderbird, LINE |
| URL blacklist prefixes | `docs.google.com/document/d`, `docs.qq.com/doc/`, `docs.qq.com/sheet/` |
| URL whitelist prefixes | `figma.com/design/` |

Two findings matter for JustSpeak:

1. **The lists are compatibility lists, not privacy tiers.** The same lists are used to
   decide whether Accessibility insertion is "best effort" or "guaranteed writable"
   (E3, `14-result-delivery.md`). They were not designed as a data-classification
   mechanism.
2. **The blacklist does not block every content read.** In the observed code, a
   blacklisted app skips visible-text and surrounding-content capture, but the cursor
   input read (`getCurrentInputState`) is not gated by the blacklist. In the WeChat
   capture, visible and surrounding text were not collected, but the cursor read was
   attempted and failed with `no_focused_element`; the experiment did not prove that the
   input text was uploaded, and it did not prove that it was not. The safe reading is:
   the list reduces some capture, not all of it (E3).

### Privacy-audit controversy and "on-device history"

Typeless's public privacy controversy is about the gap between a local-first impression
and a cloud-first implementation. Third-party privacy audits and reviews documented the
cloud processing, the breadth of context capture, and the local retention of audio and
history ([b-log.to audit](https://b-log.to/tech-analysis/typeless-privacy-audit/),
[huli.tw review](https://blog.huli.tw/notes/typeless-privacy-check/), E3). The shipped
client also keeps a large local data footprint (E3, `08-local-data.md`):

| Local artifact | Observed content |
|---|---|
| `typeless.db` (~262 MB) | History rows (3,120 on the analyzed machine), including `refined_text` in **plaintext** and `audio` metadata |
| `Recordings/*.ogg` (253 MB, 3,120 files) | One Opus recording per dictation, retained until the history-retention setting cleans them |
| `audio_context` column | The full context payload, RSA-envelope encrypted to a **server-held** key; the client cannot read it back |
| `sentry/` | A local queue for crash reports |
| `user-data.json` | Login token encrypted with a key derived from public machine/app values, **not** the macOS Keychain |

**"On-device history" only refers to history storage.** It does not mean on-device ASR,
on-device cleanup, or on-device context handling. In the observed build, audio and
context are uploaded, ASR and cleanup are server-side, and the local database is a
history/cache layer. A product may truthfully say "your history is stored on your
device" while still sending every dictation to a server. JustSpeak's public claims must
never rely on that ambiguity.

**Observed versus inferred.** The file paths, schema, limits, blacklist contents, and
network messages are static-analysis findings corroborated by packet capture (E3,
medium-high). Server-side behavior and the exact retention of uploaded data are
inference or vendor policy, not observed. JustSpeak does not claim that Typeless retains
data beyond what its policy states; it claims only that the client-side behavior is
cloud-first and context-heavy.

## Privacy-First Alternative

The alternative is not "the same product with a privacy settings page". It is a different
default path:

| Principle | Concrete rule |
|---|---|
| **Local-first ASR** | Default provider is a local sidecar (SenseVoice/Whisper through sherpa-onnx/whisper.cpp). After model download, the app works fully offline with no account and no vendor key. Cloud ASR is a separate opt-in adapter. |
| **Context capture off by default** | v0.1 collects only app identity and the narrow safety flags required for injection. No content, no title, no URL, no screen text. App identity stays local. |
| **Per-feature opt-in** | Cloud ASR, cloud LLM cleanup, selected-text context, surrounding-text context, history, telemetry, and crash upload each have their own toggle and consent text. Enabling one does not enable another. |
| **No screen capture by default** | No screenshots, no OCR, no Screen Recording permission. Visible-text capture is not in v0.1 and is not an implied roadmap feature. |
| **No raw audio retention** | Audio lives in memory for the session; buffers are zeroed after finalization. A retry clip is allowed only if the user explicitly enables retry, and it is bounded and deleted. |
| **No telemetry by default** | The app makes no analytics call in v0.1. If metrics are added, they are opt-in, content-free, and documented field by field. |
| **Local history** | History is opt-in, stored locally, and never uploaded. The default is off; the user chooses a retention period. |
| **Clear deletion** | Delete one item, delete all history, clear the dictionary, delete API keys, delete downloaded models, and reset consent. The UI explains what is deleted and what cannot be guaranteed on SSD media. |
| **No silent failover** | If local ASR fails, the app offers retry and a user-configured fallback; it never sends audio to a cloud provider the user did not enable for that session. |
| **Visible mode** | The overlay shows when cloud processing is active and which provider receives data. A local-only session is visibly local. |

### Why this is a real product, not a downgrade

The local path still covers the core dictation value: high-quality Chinese/English ASR,
VAD, deterministic punctuation/filler cleanup, a local personal dictionary, and fast
injection. Context-aware tone and app-specific formatting are quality enhancements, not
prerequisites for a usable dictation product. The ASR research already targets a local
SenseVoice default with a Whisper fallback; the privacy stance and the ASR stance are the
same decision, not two competing ones.

## Options

Three context strategies are compared. They differ in what the app reads, not only in
where it sends it.

### Option A — Full-context, Typeless-like

**Shape.** Capture app, window title, URL, cursor before/after, selected text, full field,
surrounding content, and visible screen text; send the package to a cloud ASR/cleanup
service; use app/URL blacklists; learn from post-insertion edits.

**Quality.** Highest ceiling for tone, terminology, app-aware formatting, and
"understand the field" behavior. The server sees enough context to resolve ambiguous
references and adapt output per app.

**Privacy.** Weakest. Every dictation can upload unrelated content, including terminal
secrets, chat messages, document text, URLs, and window titles. Blacklists reduce some
capture but are compatibility-driven and incomplete. Local history does not offset cloud
processing.

**Complexity.** High: Accessibility traversal across native/web/Electron apps, text-marker
handling, per-app exceptions, capture timeouts, remote blacklist updates, encryption,
consent UX, and server-side retention review.

**Verdict.** Rejected as the v0.1 default. It is the design to compete against, and the
source of the privacy controversy this product must avoid.

### Option B — Minimal context (v0.1 default)

**Shape.** Local ASR; app name/bundle id/pid/focus state plus secure/editable flags for
safe injection; no content capture; local rule-based cleanup; no network after model
download.

**Quality.** Slightly lower than full-context for tone and app-specific formatting, but
the core transcription and cleanup quality is unaffected. The local personal dictionary
recovers most terminology needs. The ASR benchmark decides whether local quality is
acceptable.

**Privacy.** Strongest. The default path cannot leak content because it does not read
content. App identity is the only contextual data, and it stays local.

**Complexity.** Lowest. It fits the accepted architecture and the current v0.1 scope; no
new permission, no AX content traversal, no server retention review.

**Verdict.** Recommended for v0.1.

### Option C — Opt-in per feature

**Shape.** Option B plus independently enabled features: selected text for a single
request, bounded surrounding text, coarse app category for cloud cleanup, cloud ASR,
cloud LLM. Each feature has a preview, hard caps, per-app blocks, and a local-only
fallback.

**Quality.** Can approach Option A for users who need context, while preserving a
local-only default for everyone else. The quality gain must be measured, not assumed.

**Privacy.** Conditional. Each enabled feature is a disclosed, bounded data flow. The
risk is consent fatigue and users enabling more than they understand; mitigations are
per-request prompts, previews, and conservative defaults.

**Complexity.** Medium-high: caps, previews, per-app policy, prompt-injection defenses,
and a privacy review per feature. It is a v0.2 direction, not a v0.1 requirement.

**Verdict.** Recommended evolution after v0.1 ships and the context-quality benchmark
shows a real gain.

### Comparison

| Criterion | A: Full-context (Typeless-like) | B: Minimal context (v0.1) | C: Opt-in per feature |
|---|---|---|---|
| ASR quality ceiling | High (cloud + context) | High enough if local benchmark passes | High when enabled |
| Context-aware cleanup | Strong | Basic (local rules, dictionary) | Strong for opted-in fields |
| Privacy default | Weak | Strong | Strong by default, conditional per feature |
| Screen/window/URL exposure | High | None | None unless a future feature explicitly adds it |
| Permission surface | Accessibility + screen-related risk | Microphone, Accessibility for output | Same as B plus per-feature consent |
| Implementation complexity | High | Low | Medium-high |
| Consent complexity | Low (one broad consent) but poor transparency | Low | High (per feature), manageable with good UX |
| Retention surface | Cloud + large local history | Local, opt-in history | Local + per-provider retention |
| Fit with frozen v0.1 scope | No | Yes | Later |
| Recommendation | Reject as default | **Adopt for v0.1** | Adopt incrementally after gates |

## Threat Model

The threat model covers the v0.1 local-first design and the optional cloud paths. "Local
attacker" means another process running as the same user; "network attacker" means an
on-path or DNS attacker; "supply-chain attacker" means a compromised dependency, model,
or update channel.

| ID | Threat | Attack path | Impact | Likelihood | Controls | Residual risk |
|---|---|---|---|---|---|---|
| T1 | **Malicious local app** reads transcript/clipboard or drives the UI | Another process reads `NSPasteboard`, injects keystrokes, or impersonates the helper; malware with Accessibility can observe everything | Transcript, clipboard, and injected text leak; actions executed in the user's apps | Medium | Clipboard transient write + restore; minimal dwell; secure-input check; code signatures; TCC; no secrets in clipboard; no privileged IPC from renderer; user education | A same-user process with Accessibility can still observe keystrokes and the clipboard; the OS trust model is the boundary |
| T2 | **Clipboard leakage** to clipboard managers, Universal Clipboard, or other apps | Transcript temporarily replaces the clipboard during paste; a manager or iCloud sync captures it | Transcript copied to other devices or history databases | High | Transient pasteboard marker (best effort); restore via `changeCount` guard; short window; "copy only" fallback; document the behavior; never place audio or keys on the clipboard | Clipboard managers may ignore the marker; Universal Clipboard may sync; cannot guarantee deletion from third-party stores |
| T3 | **Prompt injection via selected text or transcript** | Text in the transcript/selection says "ignore previous instructions"; an LLM cleanup step follows it and rewrites or exfiltrates | Meaning change, unsafe output, or disclosure if the model has tools | Medium (only with LLM enabled) | Selected text off by default; delimiters; system prompt treats text as data; deterministic validator; no tools/agent actions in v0.1; fallback to rule output; adversarial benchmark samples | A plausible same-language rewrite can pass the validator; local models can still follow instructions even without network |
| T4 | **Insecure model download** | MITM or compromised host serves tampered weights; arbitrary model URL; downgrade to a malicious model | Arbitrary code execution in the inference process, bad transcripts, or data exfiltration if the runtime has network | Medium | HTTPS with certificate validation; pinned catalog; SHA-256 of every file; atomic temp download; verify before load; no arbitrary user URL; signed catalog later; sidecar has no network; least-privilege model directory | Compromised project hosting account before checksum publication; a signed catalog is not yet implemented |
| T5 | **Supply-chain dependencies** | Malicious npm package, compromised Electron release, trojaned sidecar binary, postinstall script | Code execution in main/helper/sidecar; data theft; build compromise | Medium | Exact version pins + committed lockfile; `npm ci`; minimal dependency set; review new deps; OSV/npm audit in CI; SBOM; npm provenance/attestations; no unreviewed postinstall; checksum sidecar binaries; signed releases; dependency update cadence | A compromised maintainer or a zero-day in a pinned dependency; transitive depth is hard to audit fully |
| T6 | **Update signing and channel** | Attacker serves a malicious update, downgrades to a vulnerable build, or hijacks the feed | Persistent code execution with the app's permissions | Medium | Developer ID signing; hardened runtime; notarization + stapling; signed update metadata and payload; HTTPS; signature verification before install; rollback protection; staged rollout; signing keys in Keychain/HSM; no update check in local-only offline mode unless enabled | Compromised signing key; framework-specific update bugs; electron-updater + GitHub Releases selected, but key custody and rollback operations remain open |
| T7 | **Permission abuse / over-broad TCC** | App requests Screen Recording, Input Monitoring, Full Disk Access, or Automation "just in case"; helper attribution is opaque; permission prompts train the user to click Allow | Silent surveillance surface; user trust loss; policy violation | Medium | Least-privilege permissions; request at point of use with a plain-language reason; no Screen Recording; Input Monitoring only for Fn/Right Option; no Full Disk Access/Automation; verify TCC attribution for the signed helper; live permission status; revoke handling | Users may grant permissions to the wrong binary; macOS TCC behavior varies by version; malware can abuse the same permissions independently |
| T8 | **Crash dumps leak content** | Native crash captures heap/stack with transcript, audio, selected text, or keys; auto-upload sends it to a third party | High-sensitivity content leaves the device without consent | Medium | No automatic crash upload; local-only default; explicit preview and consent; redaction of keys and known buffers; disable core dumps for helper/sidecar where practical; short local retention; user deletion | Memory dumps are hard to fully scrub; OS crash reporter behavior is outside the app |
| T9 | **Renderer compromise / XSS** | A malicious local file, injected content, or a dependency renders script in the sandboxed renderer and calls privileged IPC | Settings/history manipulation, transcript disclosure, or helper actions | Low–medium | No remote content; strict CSP; `sandbox`, `contextIsolation`, `nodeIntegration: false`; narrow contextBridge; no generic IPC; schema validation; navigation/window.open blocked; ASAR integrity; Electron fuses | A Chromium zero-day or a compromised bundled dependency; defense-in-depth limits blast radius |
| T10 | **IPC / helper spoofing or framing attacks** | A local process connects to the helper socket, sends oversized/malformed frames, or impersonates the helper | Crash, memory corruption, unauthorized injection, or command execution | Low–medium | Stdio or `0600` Unix socket; handshake + version check; length caps; schema validation; timeouts; sender/frame checks; helper path and code-signature verification; no shell interpolation; fail closed on mismatch | Same-user local attackers can often attach debuggers; the helper must stay small and statically reviewable |
| T11 | **Local ASR sidecar compromise or resource abuse** | Malformed audio/model triggers a crash or memory corruption; sidecar is tricked into reading files or using the network | Crash, data disclosure, or resource exhaustion | Low–medium | Sidecar has no network; explicit model path; checksum verification; process isolation; kill on idle/session end; resource limits; bounded audio input; no dynamic model URL | A memory-safety bug in the runtime; mitigation is upstream patching and process isolation |
| T12 | **History/logs at rest** | Plaintext history DB or logs are read by another app, backup, or forensic tool | Transcript and dictionary disclosure | Medium | History opt-in; local-only; app-support directory with least privilege; encryption-at-rest decision (open question); content-free logs by default; retention + deletion; no transcript in crash reports | Full-disk backup and same-user malware remain; encryption key management adds complexity |
| T13 | **Cloud provider retention / jurisdiction** | Opted-in cloud ASR/LLM retains audio/text, trains on it, or stores it in an unexpected region | Content disclosure beyond the user's expectation | Medium (only with cloud enabled) | Per-provider data notice; BYOK; no silent failover; TLS; provider retention/residency review before shipping; minimal payload; no account identity; visible active mode | Provider policy and subpoena risk cannot be eliminated by the client |
| T14 | **Remote configuration / blacklist supply chain** | If a future remote config or blacklist is unsigned, an attacker changes capture/injection policy | Privacy regression or unsafe injection behavior | Low now, medium if added | Signed config; no executable content; local defaults; fail closed; versioned and auditable; no remote prompt/config in v0.1 | Key compromise or a signed bad policy; keep remote policy minimal |
| T15 | **v0.2 agent actions** | A voice agent with desktop-control tools is induced to click, type, or open URLs by malicious text | Unintended actions, data loss, or exfiltration | Future | Separate design; least-privilege tools; explicit confirmation; allowlists; local audit log; prompt-injection defenses; no autonomous destructive actions | Agent safety is not solved by prompting alone; requires design review |

## Security Controls

### 1. Build, signing, and distribution

- **Developer ID signing** for the app and every bundled native component (Swift helper,
  sidecars). The helper must be signed with the same team identity and carry a hardened
  runtime; a child process that inherits the app's TCC grant must be verifiably part of
  the signed bundle.
- **Hardened runtime** on the app and helper, with the smallest entitlement set:
  `com.apple.security.cs.allow-jit` for Electron's V8. `com.apple.security.device.audio-input`
  is an App Sandbox capability and is not required for direct distribution; microphone
  access is controlled by TCC plus `NSMicrophoneUsageDescription`. Avoid
  `disable-library-validation` unless a measured runtime requirement forces it, and
  document the reason if it does.
- **Notarization + stapling** before distribution. Gatekeeper must pass on a clean
  machine. Verify the notarized artifact, not only the local dev build.
- **Direct distribution** for v0.1 (frozen decision). Mac App Store sandboxing is not a
  constraint; Accessibility-based injection and clipboard paste are allowed outside the
  sandbox, but the app must still follow the least-privilege rules below.
- **Reproducible builds** are a later goal; until then, publish checksums and a signed
  release manifest, and keep the build script and toolchain versions pinned.
- **Release artifacts** are built from a clean, protected branch; no unsigned local build
  is ever promoted. Signing keys live in the Keychain/HSM, not in the repository.

### 2. Electron renderer and IPC

- Renderer: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`,
  `webSecurity: true`, `allowRunningInsecureContent: false`.
- Load only bundled local content; block navigation and `window.open`; no remote URLs in
  the renderer; no devtools in production builds.
- **Strict CSP**: `default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none';
  frame-ancestors 'none'`. The renderer never talks to cloud providers directly; main
  owns all network calls. If a future renderer feature needs a network origin, it is
  added explicitly and reviewed.
- **Electron fuses**: disable `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`,
  `EnableNodeCliInspectArguments`, and `OnlyLoadAppFromAsar`; enable
  `EnableEmbeddedAsarIntegrityValidation` on macOS.
- **Preload bridge**: a narrow, typed allowlist (start/stop/cancel dictation, read state,
  subscribe, open settings, validated settings read/write). Never expose `ipcRenderer`,
  `require`, `process`, or a generic `invoke(channel, payload)`.
- **IPC validation**: every renderer message is checked against a runtime schema, with
  size limits, type checks, and a sender-frame/origin check. Reject unknown channels and
  unknown fields. Validate helper messages the same way; treat the helper as trusted
  code but not as a trusted parser.
- **No eval / no new Function / no remote module loading.** Treat any such need as a
  design review, not a workaround.

### 3. Native helper and local IPC

- Out-of-process Swift helper over stdio or a Unix domain socket with `0600` permissions;
  versioned, length-prefixed frames; handshake and capability negotiation.
- Validate every command and payload: allowed command set, maximum frame size, schema,
  timeout, cancellation. Fail closed on version mismatch.
- Verify the helper path and code signature before launch; never accept a helper path from
  the renderer or an environment variable.
- No shell interpolation; no network client in the helper; no transcript storage; no
  product policy. The helper owns OS calls only.
- Bound Accessibility calls with `AXUIElementSetMessagingTimeout`; never block the main
  thread indefinitely; kill and restart on hang.
- Verify TCC attribution for the bundled helper on signed builds before release; the
  Accessibility grant should attach to the signed app, not to an opaque child process.

### 4. Secrets and permissions

- **API keys and tokens live in the macOS Keychain** (via the helper or Electron
  `safeStorage`), never in renderer storage, JSON config, logs, or crash metadata.
- One key per provider; support revoke/delete; show only a masked value in settings.
- **Least-privilege permissions**:
  - Microphone: request when the user first starts dictation, with a plain-language
    reason.
  - Accessibility: request when the user enables text output, not at first launch; explain
    that it is used to paste and to avoid password fields.
  - Input Monitoring: only if the user enables a Fn/Right Option binding; the default
    `globalShortcut` path does not need it.
  - **Never** request Screen Recording, Full Disk Access, Automation/Apple Events, or
    Accessibility "just in case".
- Check permission state before each session and after wake/unlock; degrade to
  clipboard-only when Accessibility is revoked; never fail silently.
- Secure-input and secure-field checks gate every synthesized keystroke; no logging of
  field contents.

### 5. Models, downloads, and updates

- **Model catalog**: versioned JSON with model id, runtime, language set, file list, byte
  size, SHA-256, license id, source URL, and minimum app version. Pin revisions; never
  download an unversioned "latest".
- **Checksum verification** of every file after download and before load; atomic
  temp-directory download and rename; reject partial or mismatched files; delete and
  re-download on failure.
- **No arbitrary model URLs** in v0.1. Hosting is project-owned GitHub Releases and/or
  Hugging Face; a signed catalog is a later hardening step.
- The local ASR sidecar runs without network access, with an explicit model path and
  process isolation; kill it on session end or model change.
- **Update path** (framework decision deferred): HTTPS, signed update metadata and
  payload, signature verification before install, rollback protection, staged rollout,
  and a recovery path. The app does not auto-update while a local-only offline user has
  disabled update checks.
- **Dependency pinning**: exact versions in the lockfile, committed; CI uses `npm ci`;
  minimal runtime dependencies; review every new dependency; run OSV/npm audit; produce
  an SBOM; prefer packages with provenance/attestations; review postinstall scripts;
  checksum pinned native binaries; track Electron security releases and upgrade on a
  fixed cadence.

### 6. Logging, crash handling, and audit

- Structured logs are **content-redacted by default**: no transcript, audio, selected
  text, surrounding text, clipboard content, window title, URL, dictionary entries, or
  API keys. Metrics may include latency, provider/model id, error class, app version, and
  OS version.
- A debug mode that captures content requires an explicit warning, is off by default, and
  is time-bounded. Debug logs are never uploaded automatically.
- **Crash reports are local-only by default.** No automatic upload. If upload is added,
  the user previews the payload, secrets and known content buffers are redacted, and the
  provider/retention is disclosed. Crash metadata must not include transcript text or
  provider keys.
- **v0.2 agent audit log** (separate design, reserved here): an append-only local log of
  every agent action with timestamp, action type, target app/bundle id, user confirmation,
  result, and a content-free reason. Store it locally with restrictive permissions,
  make it user-viewable/exportable, define retention, and consider a hash chain for
  tamper evidence. It must not become a transcript or screen-content log. v0.1 does not
  implement agent actions and therefore does not ship this log; it only keeps the
  boundary clear so v0.2 can add it without redesigning the core.

### 7. Data-at-rest and deletion

- App-support directory with least-privilege permissions; history and settings are
  separate from models and logs.
- History is opt-in and local. Encryption at rest is an open question: if enabled, the key
  must live in the Keychain, not beside the database.
- Delete one item, delete all history, clear the dictionary, delete keys, delete models,
  and reset consent. The UI explains that SSD wear-leveling and backups may retain copies
  the app cannot erase; "delete" means the app removes its references and files, not
  physical destruction.
- On quit or crash, audio buffers are released and not written to disk; a retry clip is
  allowed only with explicit retry opt-in.

## Consent and Privacy Policy Requirements

The privacy policy is a product artifact, not a legal afterthought. It must be accurate
enough that a privacy test can compare it with network behavior.

### Policy content

Before the first public release, the policy must state:

1. **What is processed**: microphone audio, transcripts, app identity/safety flags,
   settings, dictionary, optional history, optional telemetry/crash data, and any
   opted-in cloud data.
2. **Why**: dictation, local cleanup, injection, user-requested cloud quality, history,
   diagnostics.
3. **Where it goes**: local-only by default; the exact cloud provider and region when the
   user enables a cloud feature; every network destination (model download, update feed,
   cloud ASR, cloud LLM, optional telemetry/crash).
4. **Retention**: audio is not retained by default; history follows the user's retention
   setting; cloud retention is the provider's policy and must be named; local logs and
   crash files have bounded retention.
5. **Recipients/subprocessors**: model hosts, update host, and each optional cloud
   provider; no sale of data; no advertising analytics.
6. **User rights**: access, export, delete, withdraw consent, and reset; a contact channel;
   the process for security reports (`SECURITY.md`).
7. **International transfers** for cloud features; the policy must not imply local
   processing when a cloud feature is active.
8. **Children/minors**: the product is not directed at children; state the minimum age if
   required by the distribution policy.
9. **Changes**: material changes require in-app notice and, where required, renewed
   consent.

### Consent UX rules

- **Separate toggles** for cloud ASR, cloud LLM, selected text, surrounding text,
  history, telemetry, and crash upload. No bundled "privacy settings" switch.
- **Off by default**, no pre-checked boxes, and withdrawal as easy as grant.
- **Just-in-time consent**: ask when the feature is first used, not only in onboarding.
  Show the exact data, the destination, the retention, and a preview where practical.
- **No dark patterns**: "Not now" is as prominent as "Enable"; disabling a feature does
  not degrade unrelated functionality.
- **Visible state**: the overlay shows "local" vs "cloud (provider)" while processing.
- **Consent ledger**: record the feature, version, timestamp, and choice locally; do not
  upload it.
- **Deletion**: a single "delete my data" flow covers history, dictionary, keys, logs,
  crash files, and cached context; explain what is deleted and what remains in backups.

### Claims discipline

- Do not say "on-device" when any part of the request is cloud-processed.
- Do not say "we never store audio" if a retry clip is enabled; state the condition.
- Do not say "anonymous telemetry" unless the fields are proven non-identifying; app
  names and URLs are identifying.
- Every network destination named in code must appear in the policy, and every destination
  in the policy must be covered by a test or an audit step.

## Recommendation

Adopt **local-first processing plus opt-in context**, with **Option B (minimal context)
as the v0.1 default** and **Option C as the post-v0.1 evolution**.

### v0.1 decisions

1. **Local ASR by default.** No network after model download; cloud ASR is opt-in,
   BYOK, per provider, with a data notice and no silent failover.
2. **Context capture off by default.** Only app name/bundle id/pid/focus state and the
   secure/editable safety flags are collected, locally, for injection and per-app policy.
   No window title, URL, input content, selected text, surrounding text, screen text,
   clipboard content, or keystroke history.
3. **No screen capture.** No Screen Recording permission, no screenshots, no OCR.
4. **No raw audio retention.** In-memory only; buffers zeroed; bounded session; retry clip
   only with explicit opt-in.
5. **No telemetry by default.** If added, opt-in and content-free.
6. **Local history, off by default.** Opt-in, local-only, deletable; encryption at rest
   decided separately.
7. **Cloud cleanup is opt-in BYOK.** It sends the transcript, coarse app category
   (optional), locale, and matched dictionary terms only. No app name, window contents,
   screen text, clipboard, or history. The validator and rule fallback are mandatory.
8. **Selected/surrounding text are not in v0.1.** They are a later opt-in with caps,
   previews, per-app blocks, and prompt-injection tests.
9. **Every network destination is documented.** The table below is the v0.1 contract; any
   addition requires a doc change and a privacy review.

### Network destinations

| Destination | When | Data | Default | Retention |
|---|---|---|---|---|
| Model host (project GitHub Releases / Hugging Face) | First model download or explicit re-download | Model files; standard HTTP metadata | Allowed (needed for local ASR) | Local until deleted |
| Update feed (provider TBD) | Update check/install | App version, OS version, update metadata | Allowed but user-disableable; no update check in offline mode | Provider-defined; documented |
| Cloud ASR provider (e.g. OpenAI/Deepgram/AssemblyAI/Qwen) | Only when the user enables that provider | Audio (chunks or complete utterance), language hint, provider key | **Off** | Provider policy; disclosed |
| Cloud LLM cleanup provider | Only when the user enables cleanup | Rule-cleaned transcript, optional coarse app category, locale, matched dictionary terms | **Off** | Provider policy; disclosed |
| Telemetry endpoint | Only if the user opts in | Content-free metrics (duration, provider id, latency, error class, versions) | **Off** | Short, defined in policy |
| Crash-report endpoint | Only after explicit preview and consent | Crash dump/metadata with secrets and content redacted | **Off** | Short, defined in policy |

DNS and TLS metadata are visible to the network and the OS even when the payload is
encrypted; the policy must not claim "no metadata". The app uses TLS with certificate
validation and does not disable it for convenience.

### Security baseline checklist for v0.1 release

- [ ] Developer ID signing, hardened runtime, notarization, stapled ticket.
- [ ] Helper/sidecar signed, versioned, and restricted to the documented command set.
- [ ] Renderer sandbox, contextIsolation, CSP, fuses, no remote content.
- [ ] IPC schema validation and sender checks on every channel.
- [ ] Keychain for keys; no secrets in logs, crash dumps, or renderer storage.
- [ ] Least-privilege TCC prompts; no Screen Recording; revoke handling.
- [ ] Model SHA-256 verification and no arbitrary model URL.
- [ ] Lockfile, dependency audit, SBOM, and a review of new dependencies.
- [ ] Signed update metadata/payload and rollback protection (when updates ship).
- [ ] Local-only network test: with cloud/telemetry off, no outbound traffic after model
      download.
- [ ] Content-free logs test: no transcript/selection/URL/window title in logs or crash
      files.
- [ ] Clipboard restore and secure-field tests: no keystrokes into password fields, no
      clipboard clobbering.
- [ ] Consent flow review: separate toggles, off by default, withdrawal, deletion.

### Rejected alternatives

- **Full-context default (Typeless-like)**: rejected because the privacy cost is
  disproportionate to the v0.1 quality gain, and because the blacklist mechanism is not a
  privacy control.
- **Cloud-first / cloud-only**: rejected because it contradicts the local-first product
  and ASR decisions, requires accounts and keys, and makes the privacy story
  vendor-dependent.
- **Telemetry on by default**: rejected; even "content-free" metrics can identify usage
  patterns, and v0.1 has no need for them.
- **Raw audio retention for "quality"**: rejected; retry is the only bounded exception and
  requires opt-in.
- **Screen capture / OCR**: rejected; it is a hard boundary, not a toggle.
- **Automatic dictionary learning from edits**: rejected for v0.1; it creates a
  post-insertion surveillance path and a prompt-injection surface. Dictionary changes are
  explicit.

## Open Questions

1. **History encryption at rest:** SQLCipher versus OS file protection versus no
   encryption with a local-only threat model. If encryption is used, where is the key and
   how is it recovered after reinstall?
2. **Exact telemetry and crash-report provider:** deferred by the frozen decision. What
   fields are truly non-identifying, and can a provider meet a no-retention requirement?
3. **Selected-text UX:** per-request action versus a persistent setting; how to preview
   exactly what will be sent without making dictation slow?
4. **Surrounding-text caps:** the proposed 300 + 300 characters and 2,000 total need a
   quality benchmark and a privacy review before shipping.
5. **App category to cloud LLM:** is a coarse category worth sending by default when
   cleanup is enabled, or should even that be opt-in?
6. **Cloud provider retention/residency:** which providers offer no-retention or
   zero-data-retention terms, and what do they cost? This must be resolved before showing
   a provider in the UI.
7. **Model catalog signing:** when does a signed catalog become worth the key-management
   cost, and how are keys rotated?
8. **Update framework and signing:** electron-updater via GitHub Releases is selected
   (PACKAGING-RELEASE); who owns the signing key and the rollback policy?
9. **Keychain access path:** helper-owned Keychain items versus Electron `safeStorage`;
   which is more auditable, and how does the Windows path map to DPAPI/Credential Manager?
10. **Clipboard manager behavior:** does the transient marker work with the clipboard
    managers users actually run, and does Universal Clipboard sync it? Test before
    promising "the clipboard is restored and private".
11. **v0.2 agent audit log:** retention, hash-chain/tamper evidence, user export, and
    whether the log can be disabled without weakening accountability.
12. **Local LLM threat model:** if a local LLM is added, it still follows instructions in
    selected text; does that change the opt-in boundary or the validator requirements?
13. **Crash-dump redaction:** which memory regions can be scrubbed, and can the helper and
    sidecar run with core dumps disabled on macOS?
14. **Signed-build TCC attribution:** does the bundled helper inherit the app's
    Accessibility grant on all supported macOS versions? Verify on signed builds.
15. **Incident response:** who is notified, within what time, if a signing key, model
    checksum, or cloud key is compromised? Align with `SECURITY.md`.
16. **Reproducible builds:** which toolchain and sidecar binaries can be made
    bit-reproducible, and what is the minimum viable verification for v0.1?

## Sources

Accessed 2026-10-26 unless noted. Tags: **E2** = primary project artifact inspected
directly; **E3** = web/third-party documentation, reverse engineering, or audit.
Competitor material is evidence only; no code, prompts, assets, or model weights are
copied.

### Internal project artifacts (E2)

- [ADR-0001: Core boundary and repository strategy](ADR-0001-core-boundary.md)
- [ADR-0002: Technology stack for JustSpeak v0.1](ADR-0002-tech-stack.md)
- [ARCHITECTURE.md](ARCHITECTURE.md) — trust boundaries, data classification, controls,
  failure handling, privacy tests
- [ASR-RESEARCH.md](ASR-RESEARCH.md) — local-first recommendation, model distribution,
  checksums, cloud BYOK
- [AUDIO-PIPELINE.md](AUDIO-PIPELINE.md) — capture path, buffer bounds, zeroing, network
  test gate
- [TEXT-INJECTION-HOTKEYS.md](TEXT-INJECTION-HOTKEYS.md) — context options, clipboard
  snapshot/restore, secure-field rules, permission model
- [LLM-POSTPROCESSING.md](LLM-POSTPROCESSING.md) — context packaging, prompt injection,
  validator, no content retention
- [PRIVACY.md](PRIVACY.md) — pre-release principles and open questions
- [SECURITY.md](../SECURITY.md) — vulnerability reporting and scope

### Typeless observation (E3)

Third-party reverse-engineering notes (static analysis plus captured sessions):

- Overview and cloud processing:
  https://github.com/zephyr4123/speakmore/blob/main/targets/typeless/docs/00-overview.md
- Context capture and privacy:
  https://github.com/zephyr4123/speakmore/blob/main/targets/typeless/docs/06-context-capture-and-privacy.md
- Native helpers (AX, clipboard, keyboard):
  https://github.com/zephyr4123/speakmore/blob/main/targets/typeless/docs/07-native-helpers.md
- Local data (history DB, recordings, token storage):
  https://github.com/zephyr4123/speakmore/blob/main/targets/typeless/docs/08-local-data.md
- Result delivery and app/URL lists:
  https://github.com/zephyr4123/speakmore/blob/main/targets/typeless/docs/14-result-delivery.md

Independent privacy analyses:

- Typeless privacy audit: https://b-log.to/tech-analysis/typeless-privacy-audit/
- Independent privacy review: https://blog.huli.tw/notes/typeless-privacy-check/

Verification: the five GitHub URLs above and both audit URLs returned HTTP 200 on
2026-10-26. The substantive claims in this document are limited to what those sources
state; server-side retention and vendor intent are not asserted.

### Apple platform and security documentation (E3)

- Accessibility on Apple platforms: https://developer.apple.com/documentation/accessibility
  (HTTP 200 verified)
- `AXUIElement` API: https://developer.apple.com/documentation/applicationservices/axuielement
- Microphone usage description (`NSMicrophoneUsageDescription`):
  https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription
- Hardened runtime: https://developer.apple.com/documentation/security/hardened-runtime
- Notarizing macOS software:
  https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- Keychain services: https://developer.apple.com/documentation/security/keychain-services
- TN2150, secure event input:
  https://developer.apple.com/library/archive/technotes/tn2150/_index.html
- `NSPasteboard`: https://developer.apple.com/documentation/appkit/nspasteboard
- Gatekeeper and notarization overview:
  https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec1b6b5e4b8f/web

### Application-security guidance (E3)

- OWASP Top 10: https://owasp.org/www-project-top-ten/ (HTTP 200 verified)
- OWASP Top 10 for LLM Applications, LLM01 Prompt Injection:
  https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron fuses: https://www.electronjs.org/docs/latest/tutorial/fuses
- Electron `safeStorage`: https://www.electronjs.org/docs/latest/api/safe-storage
- Electron `contextBridge`: https://www.electronjs.org/docs/latest/api/context-bridge
- npm provenance: https://docs.npmjs.com/generating-provenance-statements
- SLSA supply-chain levels: https://slsa.dev/
- NIST Secure Software Development Framework: https://csrc.nist.gov/projects/ssdf

### Evidence notes

- E2 claims are limited to the project's own accepted design documents and configurations.
- E3 claims about Typeless are client-side observations from third-party static analysis
  and captured sessions; they are not a legal finding and are not independently
  reproduced by this project.
- Pricing, provider retention terms, and macOS TCC behavior can change; re-check before
  they appear in product copy or implementation.
- This document is docs-only. It does not claim that any control is implemented, tested,
  or measured; the release checklist is the implementation gate.

## Decision Status and Pre-Launch Self-Review

**Frozen for this card:**

- Docs-only privacy/security research and design; no code or package changes.
- Local-first stance; context capture opt-in; no raw audio retention by default; no
  telemetry by default.
- Exact telemetry/crash-report provider is a later decision; the v0.2 agent audit log is a
  separate design.
- Direct distribution (not Mac App Store) for v0.1; Keychain is available.
- v0.1 uses minimal context (Option B); full-context (Option A) is rejected as the
  default; opt-in context (Option C) is the recommended evolution.

**Recommendation summary:** local-first ASR + opt-in context; every network destination
documented; telemetry and crash upload off by default; no screen capture; no raw audio
retention; local history with clear deletion; least-privilege permissions; signed,
notarized, hardened builds; checksum-verified models; Keychain-backed secrets.

**Pre-launch self-review:** passed. The document is English, docs-only, cites E2/E3
sources, distinguishes observed competitor behavior from inference, does not claim
unimplemented controls are shipped, and is consistent with the accepted ADRs and design
baselines.
