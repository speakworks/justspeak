# Windows Port Strategy for JustSpeak

- Status: Accepted strategy for the Windows port after macOS v0.1 (helper-language spike
  pending; no Windows implementation is included in this card).
- Date: 2026-10-26
- Decision owner: FD2008
- Depends on: [ADR-0001: Core boundary](ADR-0001-core-boundary.md),
  [ADR-0002: Technology stack](ADR-0002-tech-stack.md),
  [ARCHITECTURE.md](ARCHITECTURE.md), [PACKAGING-RELEASE.md](PACKAGING-RELEASE.md),
  [TEXT-INJECTION-HOTKEYS.md](TEXT-INJECTION-HOTKEYS.md),
  [AUDIO-PIPELINE.md](AUDIO-PIPELINE.md), [PRIVACY-SECURITY.md](PRIVACY-SECURITY.md)
- Scope: Windows reuse strategy, native-helper language options, WASAPI capture,
  text injection, hotkeys, packaging/signing, testing, risks, and a recommendation.
- Excludes: Windows application code, installer implementation, CI jobs, package
  manifests, builds, signing runs, and Windows tooling installation. This document is
  docs-only.

Evidence tags: **E2** = primary project or repository artifact inspected directly for
this document (accepted design document, manifest, configuration). **E3** =
web/third-party documentation (Microsoft, Electron, electron-builder, vendor docs).
E3 claims must be re-checked before they become implementation facts. Sources were
accessed on 2026-10-26 and link status was checked; see [Sources](#sources).

## Context and Frozen Decisions

JustSpeak v0.1 ships on macOS. It is an Electron 45 + TypeScript + React 19 +
electron-vite 6 application with a small out-of-process Swift helper (ADR-0002). The
user presses a hotkey, speaks, and clean text appears at the cursor of the focused
application. `src/core` owns the audio pipeline, VAD, resampling, chunking, ASR
adapters, post-processing, model management, and the transcription settings schema, and
must stay free of Electron, React, DOM, and OS APIs (ADR-0001).

The Windows port is deliberately a **helper swap plus packaging**, not a rewrite. The
Electron main process, preload bridge, React renderer, and `src/core` are reused. The
Swift helper is replaced by a Windows helper that implements the same versioned IPC
contract, and the macOS packaging layer is replaced by a Windows installer, signer, and
update path.

The following decisions are inherited and not re-opened by this card:

| Decision | Source | Consequence for the Windows port |
|---|---|---|
| Electron 45 + TypeScript + React 19 + electron-vite 6 | ADR-0002 | Main, preload, renderer, and build pipeline are reused; only native integration and packaging change. |
| `src/core` is framework-neutral | ADR-0001, ARCHITECTURE.md | Audio DSP, VAD, chunking, ASR adapters, post-processing, model management, and settings schema do not branch on Windows. |
| Out-of-process helper over a versioned contract | ADR-0002, ARCHITECTURE.md, TEXT-INJECTION-HOTKEYS.md | The Windows helper is a peer implementation, not a new architecture. The contract must not use Swift types. |
| Local-first, no mandatory account | PRIVACY-SECURITY.md | Windows uses the same local ASR sidecar and model catalog; cloud providers remain opt-in. |
| macOS first; Windows later | ADR-0002 | This card is a strategy, not a Windows release commitment. macOS v0.1 ships first. |
| Direct distribution for v0.1 | PACKAGING-RELEASE.md | Windows direct download is the baseline; a Store channel is out of scope for the first Windows release. |
| Windows helper language not decided | ADR-0002, ARCHITECTURE.md | This document recommends one after a spike; the contract stays language-neutral. |
| NSIS assumed for Windows packaging | PACKAGING-RELEASE.md | This document compares NSIS and MSIX and confirms NSIS for direct download. |

Frozen for this card:

- Docs-only Windows strategy; no Windows implementation, code, installer, or build.
- Electron UI reuse is the baseline; the macOS v0.1 app ships first.
- The helper language (C# vs Rust) is a recommendation after a spike.
- MSIX versus NSIS is settled later; NSIS is the direct-download baseline.
- Windows 10/11 on x64 and arm64; direct distribution; a code-signing certificate is
  available later.
- Pre-launch self-review: passed.

### What "reuse" means

| Layer | macOS v0.1 | Windows port | Reuse |
|---|---|---|---|
| Electron main | Node + TypeScript, session state machine, helper client, settings, history, update | Same code with Windows paths and capabilities | Full |
| Preload | Typed `contextBridge` API | Same API; no Windows-specific surface exposed to the renderer | Full |
| Renderer | React 19 settings, overlay, onboarding, history | Same UI; copy and permission flows adapt per OS | Full with platform copy |
| `src/core` | Audio frames, resampling, VAD, endpointing, chunking, ASR adapters, post-processing, model catalog, settings schema | Same code and tests; no `process.platform` product branches | Full |
| Native helper | Swift: hotkey, capture, focus, injection, permissions, Keychain | C# or Rust helper implementing the same contract | New implementation, same contract |
| ASR runtime | Local transcribe.cpp sidecar (Qwen3-ASR default; SenseVoice/Whisper fallback); opt-in cloud adapters | Windows binaries of the same sidecar; same model catalog | High, pending runtime packaging |
| Packaging | electron-builder + DMG/ZIP + Developer ID + notarization | electron-builder + NSIS + Authenticode; MSIX later | Build shape reused, platform layer new |
| Auto-update | electron-updater + GitHub Releases + ZIP | electron-updater NSIS path + GitHub Releases | Client abstraction reused |
| Secrets | macOS Keychain | DPAPI (current user) or Credential Manager | New platform adapter |

The reuse boundary is the key product constraint: the renderer and core must not know
which OS they run on. The helper advertises capabilities (`clipboardPaste`, `uiaInsert`,
`pushToTalk`, `wasapiCapture`, `secureFieldDetection`) in the handshake, and main enables
UI only for capabilities that are present. Missing capabilities degrade to a documented
fallback, never to a crash or an invisible dead feature.

### Windows helper contract

The existing contract already uses JSON command frames and binary audio frames, which is
language-neutral. The Windows implementation should expose at least:

- `hello` / `getCapabilities` — contract version, platform, architecture, capability
  flags, helper version.
- `getPermissionStatus` / `openPermissionSettings` — microphone privacy, focus/injection
  readiness, and the Settings deep link.
- `startCapture`, `stopCapture`, `cancelCapture` — stream 16 kHz mono PCM frames with
  sequence numbers and backpressure.
- `getFocusedApp` / `getInputContext` — process id, executable name, window class,
  elevation state, secure/editable flags. No surrounding text or screen content in the
  Windows baseline.
- `injectText` — explicit mode (`clipboardPaste`, `uiaInsert`, `sendInputPaste`,
  `sendInputUnicode`) and the paste chord for the target app.
- `registerHotkey`, `unregisterHotkey`, `startHotkeyHook`, `stopHotkeyHook` — if the
  helper owns the hotkey; capability flags tell main whether the hook is available.
- `shutdown` — bounded cleanup.

Transport on Windows should be a per-user named pipe with an ACL restricted to the
current user, or stdio. Do not use TCP. Reject remote pipe clients, cap frame sizes,
validate every command, enforce timeouts, and fail closed on contract-version mismatch.
The helper must not run elevated by default, must not have a network client, and must not
store transcripts.

Secrets use DPAPI with current-user scope (or Credential Manager) through a helper or
main-process adapter. Do not copy the Keychain code path into the renderer.

### Version and support baseline

- Target Windows 11 on x64 and arm64 as the primary platform.
- Target Windows 10 22H2 x64 as a best-effort platform. Windows 10 reached its end of
  support on 2025-10-14, and 22H2 is the final version (E3). The port should not make
  Windows 10 a release blocker after that date; test it, document limitations, and
  revisit the policy before the first Windows release.
- Ship native x64 and arm64 builds. Do not rely on x64 emulation for the helper on
  arm64: audio callbacks and injection timing are sensitive to emulation, and a native
  helper is required for a credible arm64 release.
- Direct distribution is the baseline. A Store/MSIX channel is a later decision.

## Options

### Native helper language

All three candidates can call the same Win32 and COM APIs. The differences are maturity,
packaging, signing, and the maintenance cost for a solo TypeScript developer.

#### Option A — C#/.NET helper (recommended after spike)

**Shape.** A small .NET console/worker process targets `net8.0-windows` (or the current
LTS at implementation time). It uses the managed UI Automation client
(`System.Windows.Automation`), P/Invoke for `RegisterHotKey`, `SetWindowsHookEx`, and
`SendInput`, and a WASAPI wrapper (NAudio or direct COM interop) for capture. It
communicates over the versioned named-pipe/stdio contract.

**Maturity.** High. .NET is a first-class Windows platform; the UI Automation client,
P/Invoke, and COM interop are documented and widely used. NAudio is a mature, MIT-licensed
audio library. The toolchain is a single `dotnet` SDK, and the debugger and profiler are
strong. This is the shortest path from a TypeScript codebase to a working Windows helper.

**Packaging.** Publish self-contained for a predictable install (no .NET runtime
prerequisite), or framework-dependent for a smaller payload if the runtime is installed.
A self-contained single-file helper is larger than a native Rust/C++ helper; trimming and
Native AOT are available but must be validated against UI Automation and COM interop,
which are reflection- and COM-heavy. Measure startup, memory, and installer delta in the
spike. The helper sits outside the asar archive and is signed individually.

**Signing.** Authenticode-sign the helper executable and the installer with the same
certificate as the Electron app. There is no special runtime signing step. .NET
single-file extraction can create temporary files; test signed-helper behavior and
antivirus reputation on a clean machine.

**Maintainability.** High for a TypeScript developer: C# is statically typed, garbage
collected, and has excellent Windows API examples. The risks are P/Invoke signature
drift, COM apartment/threading mistakes, and a second runtime to patch. The helper is
Windows-only, so the language choice does not affect macOS.

**Evidence.** E3: .NET UI Automation overview and `System.Windows.Automation` API;
Native AOT deployment overview; NAudio repository; Microsoft WASAPI and Win32 API
documentation. E2: ADR-0002 requires a small helper and a language-neutral contract;
ARCHITECTURE.md defines the command surface.

#### Option B — Rust helper with `windows-rs`

**Shape.** A Rust binary uses the Microsoft-maintained `windows` crate (windows-rs) for
Win32/COM bindings: `RegisterHotKey`, low-level keyboard hooks, WASAPI COM interfaces,
UI Automation COM, and `SendInput`. It exposes the same contract and is built with Cargo
for `x86_64-pc-windows-msvc` and `aarch64-pc-windows-msvc`.

**Maturity.** Good and improving. windows-rs is maintained by Microsoft and generates
bindings from Microsoft metadata; it covers the APIs this helper needs. The ecosystem
has fewer high-level UI Automation examples than .NET, and the helper code will use
`unsafe` COM calls and manual interface lifetimes. It is a credible choice for a
performance- and size-sensitive helper.

**Packaging.** Best of the three: a small native executable with no runtime dependency.
Cross-compilation from macOS is possible for checking, but a Windows build agent is
required for MSVC linking, signing, and real API tests. Static CRT linking avoids a
Visual C++ redistributable dependency.

**Signing.** The same Authenticode process as C#: sign the helper and installer, timestamp
them, and verify with `signtool`. A small native binary has no runtime prerequisites and
is easy to place beside the Electron app.

**Maintainability.** Mixed. Rust's safety and small binaries are attractive, but the
helper is exactly the place where COM lifetimes, apartment threading, and `unsafe`
blocks are unavoidable. For a solo TypeScript developer, this is a steeper learning and
debugging curve than C#. Compile times and generated-binding churn add friction. If the
project gains a Rust maintainer, this option becomes stronger.

**Evidence.** E3: windows-rs repository and generated documentation; Microsoft Win32
documentation; Rust target documentation. E2: the helper contract and process boundary
are already fixed by ADR-0002/ARCHITECTURE.md, so the language is an implementation
detail.

#### Option C — C++/WinRT helper

**Shape.** A C++ helper uses C++/WinRT where WinRT projections exist and raw COM/Win32
for UI Automation and WASAPI, which are Win32 COM APIs rather than WinRT APIs. It is
built with MSVC and packaged as a native executable.

**Maturity.** High for Windows native development, but C++/WinRT is a projection for
WinRT, not a simplification of the Win32 COM surface this helper needs. UI Automation
(`IUIAutomation`) and WASAPI (`IAudioClient`) are still COM interfaces with manual
reference counting and HRESULT handling. C++/WinRT does not remove that work.

**Packaging.** Small native executable; link the C++ runtime statically or ship the
Visual C++ redistributable. Build tooling is the heaviest of the three (MSVC, Windows
SDK, possibly vcpkg), and cross-compilation is not a goal.

**Signing.** Authenticode, identical to the other options.

**Maintainability.** Lowest for this project. A solo TypeScript developer would own
manual memory management, COM lifetime bugs, and a large build surface for a helper that
should stay small. C++ is justified only if a maintainer with existing C++/COM expertise
joins and a specific API gap demands it.

**Evidence.** E3: C++/WinRT documentation; Microsoft UI Automation and WASAPI COM
documentation; signtool documentation. E2: the helper is deliberately small and
replaceable (ARCHITECTURE.md), so a high-maintenance language is disproportionate.

#### Rejected alternatives

- **Node native addon / FFI in the main process.** Rejected by ADR-0002 and
  TEXT-INJECTION-HOTKEYS.md: a native crash takes down the app, ABI coupling requires a
  rebuild on every Electron major, and Windows reuse becomes harder. The out-of-process
  helper is the crash and platform boundary.
- **Electron APIs only, no helper.** Electron cannot reliably read the focused element,
  detect secure fields, or inject text safely across Windows apps. It also cannot own
  WASAPI capture with device diagnostics. This repeats the macOS conclusion in
  TEXT-INJECTION-HOTKEYS.md.
- **Tauri/Rust shell rewrite.** The Electron shell is frozen for v0.1 and Windows reuse is
  a core goal. A shell rewrite is out of scope and would discard the UI and main-process
  investment.

### Audio capture

#### Option A — WASAPI shared-mode capture in the Windows helper (recommended)

**Shape.** The helper uses `IMMDeviceEnumerator` to select a capture endpoint, activates
`IAudioClient`, initializes it in shared mode, and reads packets with
`IAudioCaptureClient`. The stream is converted to 16 kHz mono 16-bit PCM and sent to main
over the binary contract. The audio engine's mix format is typically 48 kHz float
stereo; the helper should accept the mix format and let `src/core` resample rather than
assuming the device can deliver 16 kHz.

**Device selection.** Enumerate active capture endpoints with
`EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)`. Support the Windows device roles:
`eConsole`, `eCommunications`, and `eMultimedia`. Expose a stable endpoint ID, friendly
name, and default-role status in settings. Subscribe to `IMMNotificationClient` for
device added/removed/state/default changes and re-resolve the endpoint at session start.
If the saved endpoint is gone, fall back to the default communications device and tell
the user. This is materially better than renderer `deviceId` selection.

**Format and resampling.** Capture at the endpoint mix format, downmix to mono, and
resample to 16 kHz in `src/core` with a deterministic polyphase FIR (48 kHz → 16 kHz is
3:1; 44.1 kHz requires a rational resampler). Convert float samples to Int16 with
clipping and no silent gain changes. Unit-test with sine sweeps and synthetic speech;
check alias products above 8 kHz, effective sample rate, and CPU cost. Do not assume the
OS resampler is transparent. If the shared-mode format is unavailable or the device
rejects the stream, surface a typed error rather than silently recording at the wrong
rate.

**Permissions and privacy.** Windows 10/11 gates microphone access through Settings >
Privacy & security > Microphone. There is a global microphone access switch and a
separate "Let desktop apps access your microphone" switch that applies to desktop
applications as a class, not per executable. If access is off, capture fails; the helper
returns a typed permission error and main deep-links to `ms-settings:privacy-microphone`.
Windows shows a microphone-in-use indicator while capture is active; JustSpeak should
keep the overlay visible and stop capture immediately on cancel. There is no macOS-style
TCC prompt per app, so onboarding must explain the Settings path instead of waiting for
a prompt. Handle muted/disabled endpoints, Bluetooth HFP route changes, and exclusive-mode
contention as first-class errors.

**Pros.** Real device enumeration and roles, stable endpoint IDs, permission diagnostics,
no Chromium audio service in the capture path, native crash isolation, and the same
16 kHz PCM format and `src/core` pipeline as macOS. The helper already exists for hotkeys
and injection, so this adds one responsibility rather than a second process.

**Cons.** Native audio code and a binary IPC stream to maintain; a divergence from the
macOS renderer-capture default; WASAPI shared-mode latency and mix-format variability
must be measured. Bluetooth route changes and communications-role behavior need testing.

**Evidence.** E3: Microsoft WASAPI, capturing-a-stream, audio-endpoint-devices,
device-properties, device-roles, device-formats, `IAudioClient::Initialize`, and
`IMMDeviceEnumerator` documentation. E2: AUDIO-PIPELINE.md fixes the 16 kHz mono Int16
target, bounded buffers, and core ownership of resampling/VAD; ARCHITECTURE.md assigns OS
audio capture to the helper in its fallback architecture.

#### Option B — WASAPI exclusive-mode capture

**Shape.** The helper initializes an exclusive-mode stream and requests a specific format
(for example 16 kHz mono) directly from the device.

**Pros.** Lowest latency and jitter, and the device format is explicit. No audio-engine
mixer in the path.

**Cons.** The stream takes exclusive control of the device, which can break other apps;
not every device supports 16 kHz mono; format negotiation and error handling are more
complex; Bluetooth and communications devices vary. This is not acceptable as the default
for a dictation app that must coexist with meetings and media.

**Verdict.** Keep as a diagnostic or advanced option only if shared-mode latency misses
the gates. Do not ship it as the default.

#### Option C — Renderer Web Audio capture (macOS reuse)

**Shape.** Reuse the macOS renderer path: `getUserMedia` → `AudioContext` →
`AudioWorkletNode` → preload bridge → main → `src/core`. The helper supplies device
metadata and permission diagnostics only.

**Pros.** Maximum code reuse; one audio stack across macOS and Windows; the renderer and
core are already designed for it; no native audio code in the Windows helper. This is the
cheapest path to a first Windows build.

**Cons.** Chromium's Windows audio service sits between the app and the device; device
selection is origin-scoped `deviceId` rather than endpoint IDs and roles; the Windows
privacy switch is still a global desktop-app gate but the app-level permission path adds
a second layer; Bluetooth route behavior is mediated by Chromium; and a renderer crash or
reload loses the session buffer. The macOS AUDIO-PIPELINE already records renderer
capture as a product trade-off, not a technical superiority claim.

**Verdict.** Credible fallback and the fastest alpha path. The recommendation below uses
WASAPI in the helper for the Windows baseline, with renderer capture as the fallback if
the helper misses latency or device gates.

#### Option D — Other capture paths

- **WASAPI loopback / system audio.** Not a microphone substitute; reject.
- **WaveIn / waveOut legacy APIs.** Legacy and less capable than WASAPI; reject.
- **Third-party capture SDK.** Adds a vendor dependency and licensing cost for no v0.1
  need; reject.
- **Cloud audio capture.** Not a capture path; reject.

### Text injection

#### Option A — Clipboard + `Ctrl+V` (recommended default)

**Shape.** The helper checks the target for secure-field/elevation constraints, snapshots
the clipboard, writes the transcript as `CF_UNICODETEXT`, sends the target-appropriate
paste chord with `SendInput`, waits a bounded time, and restores the clipboard only if
`GetClipboardSequenceNumber` shows no external write. On failure it leaves the transcript
on the clipboard and shows a "copied, paste manually" notice. Do not retry automatically.

**Paste chord.** Windows is not uniform: many apps use `Ctrl+V`, Windows Terminal commonly
uses `Ctrl+Shift+V`, and some terminals use `Shift+Insert` or right-click paste. The
helper should resolve the chord from the foreground executable and window class using a
small static per-app map with a user override. Test console hosts (cmd, PowerShell,
Windows Terminal/ConPTY), VS Code/Cursor, JetBrains IDEs, browsers, Office, chat apps, and
self-drawn UIs.

**Clipboard behavior.** Snapshot at least Unicode text and common formats; restoring every
delayed-render format is not reliable. Use the clipboard sequence number to detect a user
copy during injection and never clobber the user's newer content. Clipboard history and
Cloud Clipboard may capture the transcript; the Windows clipboard offers best-effort
exclusion formats (`CanIncludeInClipboardHistory`, `CanUploadToCloudClipboard`,
`ExcludeClipboardContentFromMonitorProcessing`) but these are conventions, not a
guarantee. Document the behavior; do not claim the clipboard is private.

**Secure fields and secure desktop.** Detect password fields with UI Automation
(`IsPasswordProperty`) where available and skip injection. On the UAC secure desktop,
normal hooks, UIA, and synthetic input do not reach the target; leave the transcript on
the clipboard. Never synthesize keys into a password field or a secure desktop.

**Pros.** Highest cross-app compatibility; works in terminals, IDEs, browsers, Electron
apps, Office, and self-drawn UIs; the same shape as the macOS v0.1 clipboard-first
decision; no need for a universal UIA write API that does not exist.

**Cons.** Clipboard side effects, clipboard managers, Cloud Clipboard, per-app paste
chords, and extra latency for snapshot/restore. These are bounded and testable, not
eliminated.

**Evidence.** E3: Microsoft clipboard documentation; SendInput documentation; UI
Automation security overview; Windows Terminal/console behavior to verify in the
compatibility matrix. E2: TEXT-INJECTION-HOTKEYS.md freezes clipboard-first for macOS and
documents the same side effects; ARCHITECTURE.md requires a fallback that never loses the
transcript.

#### Option B — UI Automation insertion

**Shape.** Use the managed UIA client (`AutomationElement.FocusedElement`) to inspect the
focused element, check `IsPasswordProperty`, `IsEnabled`, and `IsOffscreen`, and use
available patterns. `ValuePattern` sets the whole value (destructive); `TextPattern`
exposes ranges and selection but is not a universal "insert at caret" API. UIA is best
used for **detection and a targeted fast path**, not as the default writer.

**Pros.** No clipboard side effects when a writable pattern exists; can detect secure
fields and editability; can be fast in native Win32/UWP controls.

**Cons.** Coverage is inconsistent across browsers, Electron apps, terminals, Java apps,
and self-drawn UIs; UIA calls can hang, so every call needs a timeout and must stay off
the UI-critical path; cross-bitness and elevated targets need verification; there is no
standard caret insertion for arbitrary apps. A whole-value write can delete existing
content and must never be a default.

**Verdict.** Opt-in fast path for whitelisted native apps after a per-app compatibility
matrix. Fall back to clipboard paste on any failure.

#### Option C — `SendInput` Unicode keystrokes

**Shape.** Send `KEYEVENTF_UNICODE` key events to type the transcript, or send the paste
chord.

**Pros.** Layout-independent for Unicode text; reaches apps that accept keyboard input
but reject paste.

**Cons.** Slow for long text; triggers autocorrect, IME composition, and per-character
undo; partial insertion is possible; terminals may interpret control characters; UIPI
blocks input into higher-integrity processes, and the SendInput documentation warns that
neither the return value nor `GetLastError` reliably reports the UIPI block. It is not
atomic and retrying can duplicate text.

**Verdict.** Use SendInput for the paste chord only. Keep Unicode typing as a last-resort
short-text fallback behind a flag and a strict length cap.

#### Option D — Text Services Framework (TSF)

**Shape.** Implement a TSF text service to compose text into the focused application.

**Pros.** Native text-input integration; can work well in TSF-aware applications.

**Cons.** TSF is an IME/text-service architecture, not a general cross-app injection
mechanism; implementation and registration are heavy; coverage and debugging are poor for
a small helper; it does not solve secure or elevated targets.

**Verdict.** Rejected for the first Windows release. Revisit only if a specific app class
demands it.

#### Injection failures and degradation

| Failure | Detection | Behavior |
|---|---|---|
| No focused editable field | UIA reports no focused element or not editable | Do not synthesize input; leave text on clipboard with a notice |
| Password/secure field | UIA `IsPasswordProperty`; secure desktop | Do not type; leave text on clipboard |
| Elevated target | Target integrity level / UIPI; SendInput silent failure | Do not retry blindly; copy to clipboard and ask the user to paste |
| Clipboard locked by another app | `OpenClipboard` fails or sequence changes | Retry briefly; if still locked, keep transcript in app and show a copy action |
| User copies during injection | Clipboard sequence number changes | Do not restore the old snapshot; the user's clipboard wins |
| Paste chord wrong for the app | No text appears; app-specific behavior | Use the per-app map or user override; do not auto-retry |
| Target pastes late | Bounded wait expires | Keep the transcript on the clipboard; never paste a second copy |
| UIA call hangs | Timeout | Fall back to clipboard paste; never block the session |
| RDP / session switch | Session notification | Cancel the injection; keep the transcript; do not inject into the reconnect desktop |

### Hotkeys

#### Option A — Electron `globalShortcut` (reuse baseline)

**Shape.** Main registers a configurable toggle with Electron `globalShortcut`. On
Windows this maps to the same OS-level hotkey registration primitive. Check the boolean
return, surface conflicts, and re-register after resume/session changes.

**Pros.** No new helper code; maximum reuse; simple toggle behavior; consistent with the
macOS v0.1 default.

**Cons.** No key-up events, no modifier-only triggers, and no push-to-talk; conflict
reporting is a boolean, so the app cannot name the owning app. It cannot observe the
release edge needed for hold-to-talk.

**Verdict.** Use for the baseline toggle. Keep the helper hotkey capability for the
features Electron cannot express.

#### Option B — `RegisterHotKey` in the helper

**Shape.** The helper registers a system-wide hotkey with `RegisterHotKey` and receives
`WM_HOTKEY` in its message loop. It reports registration success/failure to main.

**Pros.** Real Win32 hotkey behavior; conflict failure is detectable; no admin required
for ordinary combinations; works while the helper is alive; the helper can report richer
diagnostics than Electron's boolean. It is the same primitive Electron uses on Windows,
so behavior is familiar.

**Cons.** No key-up or modifier-only support; reserved combinations and another app's
registration can conflict; there is no reliable system API to enumerate the owner; it is
per-session and not active on the secure desktop. It adds helper code for a capability
Electron already provides.

**Verdict.** Use only if Electron's conflict/capability reporting proves insufficient, or
to keep hotkey state consistent with a future push-to-talk hook. Not required for the
first Windows build.

#### Option C — Low-level keyboard hook in the helper

**Shape.** The helper installs `WH_KEYBOARD_LL` with `SetWindowsHookEx`, receives
`KBDLLHOOKSTRUCT` events including key-up (`LLKHF_UP`), and can swallow the trigger by
returning 1. It requires a message loop on the installing thread.

**Pros.** The only option that supports push-to-talk, modifier-only triggers, and
press/release semantics; can suppress the trigger from the foreground app.

**Cons.** The hook is global and can be removed if it exceeds `LowLevelHooksTimeout`;
antivirus/EDR may flag or block it; it does not run on the secure desktop; another hook
can see or swallow events first; non-elevated hooks and elevated foreground apps need a
verification spike. It adds a high-risk surface for a feature that many users do not
need.

**Verdict.** Add in a later phase for push-to-talk after a spike. Keep
`RegisterHotKey`/`globalShortcut` as the fallback. Never require admin for the helper.

#### Conflicts and elevated apps

- Check the registration result; never pretend a taken hotkey works. Provide a
  "press your shortcut now" diagnostic and a free-binding picker.
- Do not use reserved Windows key combinations as defaults.
- A normal hotkey fires regardless of which app is foreground, including elevated apps;
  the injection step is the part that UIPI can block.
- The helper must not run elevated by default. If injection into elevated apps becomes a
  hard requirement, evaluate a separate, explicitly installed UIAccess/elevated broker as
  a later security design, not as a silent elevation of the main helper.
- Re-register hotkeys and re-enable hooks after sleep/resume and session changes; show a
  visible "hotkey inactive" state if recovery fails.

### Packaging, signing, and updates

#### Option A — NSIS + electron-builder + electron-updater + Authenticode (recommended)

**Shape.** electron-builder packages the electron-vite output into a per-user NSIS
installer, signs the app, helper, sidecars, and installer with Authenticode, and publishes
`latest.yml` update metadata. electron-updater consumes the NSIS differential update path
and verifies the publisher name and hashes.

**Pros.** Best direct-download UX; per-user install without admin; familiar wizard and
uninstall entry; the same packaging tool and update metadata family as the macOS design;
differential updates; compatible with a helper placed beside the app; works with the
frozen electron-vite build. It is the least surprising path for a solo maintainer.

**Cons.** SmartScreen reputation is earned over time; the certificate and timestamping
infrastructure must be ready; NSIS update behavior differs from MSIX; per-user installs
can complicate multi-user machines; antivirus may inspect the installer and helper.

**Evidence.** E3: electron-builder NSIS documentation; Electron application distribution
and code-signing documentation; signtool documentation; SmartScreen documentation. E2:
PACKAGING-RELEASE.md already assumes NSIS + electron-updater + Authenticode for Windows.

#### Option B — MSIX + App Installer

**Shape.** Package the app and helper as an MSIX package, sign the package, and update via
App Installer or a Store/enterprise channel.

**Pros.** Clean package identity and uninstall; App Installer update model; good
enterprise deployment; Store distribution is possible later; package integrity and
signing are first-class.

**Cons.** The update model is not electron-updater; do not mix MSIX with the NSIS update
feed without a separate design. Packaging a helper and ASR sidecar inside an MSIX package
requires care; file-system and registry virtualization change path assumptions; MSIX has
its own signing/trust setup; direct-download UX is less familiar than an installer. It is
a second release pipeline for a small team.

**Verdict.** Use for an enterprise/Store channel later, not for the first direct-download
release. Do not mix MSIX and electron-updater in one release.

#### Option C — Portable ZIP or unpacked directory

**Pros.** No installer, no admin, easy for developers.

**Cons.** No uninstall entry, no update integration, no Start menu integration, and users
must manage the helper and sidecars manually. It is a developer artifact, not a public
release.

**Verdict.** Keep as a debug artifact only.

#### Option D — MSIX plus electron-updater in one release

Rejected. The update models conflict; a package that can be updated by two mechanisms is
hard to reason about and hard to support.

#### Code signing and auto-update details

- Use Authenticode with an OV/EV certificate or Azure Trusted Signing / Microsoft
  Artifact Signing. Sign the installer, the Electron executable, the helper, and every
  native sidecar. Timestamp every signature.
- Verify with `signtool verify /pa /all` and inspect the signer on the final artifacts.
  Signing only the outer installer is insufficient.
- Plan for SmartScreen reputation: a new certificate starts with little reputation, and
  reputation is not guaranteed by buying a certificate. Publish stable, signed releases
  and monitor SmartScreen feedback.
- electron-updater on Windows must verify the expected publisher name, not only the
  SHA-512 hash. Keep the feed URL fixed and non-user-configurable; use HTTPS; publish a
  beta channel and a rollback procedure.
- Auto-update must not run during an active dictation session or a model download. Do not
  silently restart the app.
- x64 and arm64: ship native builds. A single NSIS installer can select the architecture-
  specific payload, or ship separate installers; decide after measuring download size and
  CI cost. The helper and sidecars must match the architecture.
- Windows 10 22H2 is the final Windows 10 release and is out of support (E3); Windows 11
  is the primary target. Keep Windows 10 builds best-effort and state the tested build in
  release notes.

## Comparison

Scores are 1 (worst) to 5 (best). They are the author's judgment informed by the cited
documentation, not measured benchmarks. Weights reflect the project's priorities: reuse,
a solo TypeScript maintainer, reliability across real Windows apps, and a direct-download
release.

### Helper language

| Criterion | Weight | A: C#/.NET | B: Rust + windows-rs | C: C++/WinRT |
|---|---:|---:|---:|---:|
| Windows API coverage (UIA, WASAPI, hooks, SendInput) | 0.20 | 5 | 5 | 4 |
| Maturity, docs, and ecosystem | 0.15 | 5 | 4 | 5 |
| Packaging and runtime footprint | 0.15 | 3 | 5 | 5 |
| Signing and distribution simplicity | 0.10 | 5 | 5 | 5 |
| Maintainability for a solo TypeScript developer | 0.20 | 4 | 2 | 1 |
| Debugging and testability | 0.10 | 4 | 3 | 2 |
| Spike speed and iteration | 0.10 | 5 | 3 | 2 |
| **Weighted total** | **1.00** | **4.40** | **3.85** | **3.40** |

Reading the matrix:

- C# wins on maintainability, debugging, and spike speed, which dominate for a solo
  maintainer. Its weakness is runtime/packaging size, which is measurable and manageable
  with self-contained publishing or trimming.
- Rust wins on footprint and has excellent Windows API coverage, but the COM/`unsafe`
  surface and the learning curve are real costs for this team. It becomes the better
  choice if the project gains Rust expertise or helper size becomes a hard product
  constraint.
- C++/WinRT has strong native packaging but does not simplify the Win32 COM work this
  helper actually needs. It is the highest-maintenance option for this project.

### Audio capture

| Criterion | Weight | A: WASAPI shared in helper | B: WASAPI exclusive | C: Renderer Web Audio |
|---|---:|---:|---:|---:|
| Reuse of existing code | 0.20 | 2 | 2 | 5 |
| Device selection and diagnostics | 0.20 | 5 | 5 | 3 |
| Latency and jitter control | 0.15 | 4 | 5 | 3 |
| Permission/privacy UX | 0.15 | 4 | 4 | 3 |
| 16 kHz conversion control | 0.10 | 5 | 4 | 3 |
| Implementation cost | 0.10 | 3 | 2 | 5 |
| Windows reliability and coexistence | 0.10 | 5 | 3 | 3 |
| **Weighted total** | **1.00** | **3.90** | **3.65** | **3.60** |

Reading the matrix:

- WASAPI shared mode wins on device control, privacy diagnostics, conversion control, and
  coexistence. It costs native audio code and a divergence from the macOS renderer path.
- Renderer Web Audio is the reuse-maximizing option and a credible fallback, but it gives
  up endpoint identity, device roles, and native permission diagnostics.
- Exclusive mode is not a default for a dictation app that must coexist with meetings and
  media. Keep it as a diagnostic.

### Text injection

| Criterion | Weight | A: Clipboard + `Ctrl+V` | B: UI Automation | C: `SendInput` Unicode | D: TSF |
|---|---:|---:|---:|---:|---:|
| Cross-app reliability | 0.30 | 5 | 3 | 4 | 2 |
| Clipboard side effects | 0.15 | 2 | 5 | 5 | 5 |
| Terminals / IDEs / Electron apps | 0.20 | 4 | 2 | 3 | 2 |
| Secure-field safety | 0.15 | 4 | 3 | 1 | 3 |
| Latency and atomicity | 0.10 | 4 | 4 | 2 | 4 |
| Implementation cost | 0.10 | 4 | 3 | 3 | 1 |
| **Weighted total** | **1.00** | **3.95** | **3.20** | **3.10** | **2.60** |

Reading the matrix:

- Clipboard paste wins because it works in the apps people actually dictate into,
  including terminals, IDEs, browsers, Electron apps, and self-drawn UIs. Its weakness is
  the clipboard, which is a known, bounded side effect with a snapshot/restore protocol.
- UI Automation is valuable for secure-field detection and a whitelisted fast path, not
  as the default writer. It has no universal caret-insertion API.
- SendInput Unicode is a last-resort fallback; its UIPI and IME failures are not
  acceptable as a default. SendInput for the paste chord is part of the clipboard path.
- TSF is too heavy and too narrow for the first Windows release.

### Hotkeys

| Criterion | Weight | A: Electron `globalShortcut` | B: `RegisterHotKey` helper | C: Low-level hook |
|---|---:|---:|---:|---:|
| v1 reuse and delivery speed | 0.30 | 5 | 3 | 2 |
| Push-to-talk / modifier-only / key-up | 0.15 | 1 | 1 | 5 |
| Conflict diagnostics | 0.20 | 3 | 4 | 3 |
| Permission and admin cost | 0.15 | 5 | 5 | 3 |
| Recovery after sleep/session changes | 0.10 | 3 | 4 | 2 |
| Elevated-foreground behavior | 0.10 | 4 | 4 | 3 |
| **Weighted total** | **1.00** | **3.70** | **3.70** | **3.00** |

Reading the matrix:

- Electron `globalShortcut` and helper `RegisterHotKey` are the same OS primitive on
  Windows. Electron wins on reuse; the helper wins on diagnostics and capability
  reporting. Start with Electron for the toggle and move registration into the helper only
  if a concrete need appears.
- The low-level hook is the only option for push-to-talk and modifier-only triggers. Its
  hook-timeout, EDR, and secure-desktop constraints make it a later phase, not the
  baseline.
- No option works on the secure desktop; the UI must treat that as expected behavior.

### Packaging and updates

| Criterion | Weight | A: NSIS + electron-updater | B: MSIX + App Installer | C: Portable ZIP |
|---|---:|---:|---:|---:|
| Direct-download install UX | 0.25 | 5 | 3 | 2 |
| Auto-update fit | 0.20 | 5 | 2 | 1 |
| Signing and SmartScreen path | 0.15 | 4 | 3 | 1 |
| Enterprise/Store deployment | 0.15 | 2 | 5 | 1 |
| Implementation cost | 0.15 | 4 | 2 | 5 |
| Helper/arm64 packaging fit | 0.10 | 5 | 3 | 5 |
| **Weighted total** | **1.00** | **4.25** | **2.75** | **2.25** |

Reading the matrix:

- NSIS wins for direct distribution: per-user install, electron-updater differential
  updates, and one release pipeline with the existing Electron build.
- MSIX is the better enterprise/Store channel later, but it is a second update model and
  should not be mixed with electron-updater.
- Portable ZIP is a developer artifact.

## Recommendation

Adopt the following Windows strategy after macOS v0.1 ships:

1. **Reuse the Electron application and `src/core` unchanged.** Keep main, preload,
   renderer, and the core pipeline platform-neutral. The only platform-specific
   components are the helper, the ASR sidecar binaries, and packaging/signing.

2. **Choose the helper language after a time-boxed spike, with C#/.NET as the leading
   candidate.** Build a C# helper that exercises the contract, WASAPI capture,
   `RegisterHotKey`, a low-level hook, UI Automation inspection, and clipboard paste.
   Choose C# if the spike meets the gates below. Choose Rust/windows-rs if the .NET
   helper's startup, memory, or installer delta is unacceptable, or if a Rust maintainer
   joins. Keep the contract language-neutral so the choice is reversible.

3. **Use WASAPI shared-mode capture in the Windows helper, with renderer Web Audio as the
   fallback.** Capture the endpoint mix format, downmix to mono, and resample to 16 kHz
   mono Int16 in `src/core`. Use endpoint IDs and Windows device roles; subscribe to
   device-change notifications; handle the Windows microphone privacy switches and
   Bluetooth route changes. If the WASAPI path misses the latency/device gates, fall back
   to the macOS renderer capture path and keep the same core pipeline.

4. **Use clipboard + `Ctrl+V` as the default injection path, with UIA as an opt-in fast
   path.** Detect secure fields with UIA and skip them. Resolve the paste chord per app
   (terminals may need `Ctrl+Shift+V` or `Shift+Insert`). Snapshot and restore the
   clipboard with a sequence-number guard; never retry a paste automatically. Do not run
   the helper elevated by default; elevated targets degrade to clipboard-only with a
   visible notice.

5. **Use Electron `globalShortcut` for the baseline toggle and a helper low-level hook
   for push-to-talk later.** RegisterHotKey and globalShortcut are the same OS primitive
   on Windows; use the helper registration only if conflict/capability reporting demands
   it. Keep the hook behind a capability flag, handle hook timeouts and EDR interference,
   and keep register-hotkey as the fallback. Never require admin.

6. **Ship NSIS + electron-builder + electron-updater with Authenticode signing.** Use a
   per-user install with no admin requirement, sign the installer, app, helper, and
   sidecars, verify signatures, and use electron-updater's NSIS path with publisher-name
   verification. Add MSIX only for a later enterprise/Store channel; do not mix it with
   electron-updater.

7. **Target Windows 11 x64/arm64 as primary and Windows 10 22H2 x64 as best-effort.**
   Windows 10 is out of support and 22H2 is its final version (E3). Do not let Windows 10
   block the Windows release; document the tested build and limitations.

8. **Keep the Windows release direct-distribution first.** A code-signing certificate is
   available later; do not publish unsigned builds. The first Windows release should be a
   signed NSIS installer, not a Store package.

### Helper spike gates

The language decision is not a coin flip. The spike must demonstrate:

1. The helper starts and completes `hello`/capability negotiation in under 300 ms warm on
   a base x64 machine (and under 500 ms on arm64), with a documented cold-start number.
2. WASAPI shared-mode capture delivers 16 kHz mono frames with the first frame within
   400 ms p95 of the start command and stop-to-last-frame within 80 ms, matching the
   macOS audio targets where applicable.
3. The 16 kHz resampler passes a sine-sweep alias check and a speech intelligibility
   check, with acceptable CPU on the base machine.
4. `RegisterHotKey` conflict detection and recovery after sleep/resume work; the low-level
   hook receives key-down/up and is re-enabled after a forced timeout.
5. UI Automation returns the focused element, `IsPasswordProperty`, and editability for a
   representative app set without hanging past the configured timeout.
6. Clipboard paste succeeds in at least 12 representative apps, including terminals,
   IDEs, browsers, Office, chat, and an Electron app; clipboard restore succeeds when the
   sequence number is unchanged.
7. The packaged, signed helper runs beside the Electron app, is not inside the asar
   archive, and passes `signtool verify /pa /all`.
8. The installer delta, helper memory, and startup time are measured and accepted before
   the language is frozen.

If C# fails gates 1, 3, 6, or 7, evaluate Rust before committing. If WASAPI fails gates 2
or 3, use renderer Web Audio and keep the core resampler. If injection fails gate 6 in
terminals, expand the per-app paste map before changing the architecture.

### Phased delivery

| Phase | Scope | Exit gate |
|---|---|---|
| 0 — Spike | C# and/or Rust helper skeleton; contract; WASAPI; hotkeys; UIA inspection; clipboard paste; signed helper | Spike gates above; language recommendation recorded |
| 1 — Windows alpha | Reused Electron UI; NSIS; toggle hotkey; WASAPI capture; clipboard injection; privacy onboarding; x64/arm64 builds | 12-app matrix; signed installer; no transcript in logs; Windows 11 x64/arm64 smoke |
| 2 — Windows beta | Push-to-talk hook; UIA fast path for whitelisted apps; conflict diagnostics; auto-update; Windows 10 best-effort | Hook recovery; UIA compatibility matrix; update from previous build; SmartScreen check |
| 3 — Windows 1.0 | Signed direct-download release; arm64 native; rollback rehearsal; optional MSIX design | Release checklist; security review; Windows 11 support statement |

### What would change the recommendation

- If the .NET helper cannot meet startup/memory/installer gates, switch to Rust.
- If WASAPI shared mode cannot coexist with Bluetooth/communications devices, keep the
  renderer capture path and treat WASAPI as a later optimization.
- If UI Automation proves reliable across most target apps, promote it to an opt-in fast
  path sooner; do not make it the default without the matrix.
- If Windows 10 testing cost exceeds its remaining user value, drop Windows 10 support
  and state Windows 11 as the minimum.
- If the project gains a Rust or C++ maintainer with Windows COM experience, re-run the
  helper comparison; the contract makes the language replaceable.

## Testing Matrix

### Operating systems and hardware

| Configuration | Role | Required checks |
|---|---|---|
| Windows 11 x64 (current release) | Primary | Full suite |
| Windows 11 x64 (previous release, for example 23H2/24H2) | Compatibility | Hotkey, capture, injection, update |
| Windows 11 arm64 | Primary architecture | Full suite with native arm64 helper and sidecars |
| Windows 10 22H2 x64 | Best-effort | Hotkey, capture, injection, installer; document gaps |
| Windows 11 x64 VM | CI/clean-install | Install, upgrade, uninstall, signature verification |
| Windows 11 arm64 VM/device | CI/clean-install | Native helper load, audio, injection |
| RDP session | Remote use | Capture, injection, session switch, clipboard |
| Multi-monitor / mixed DPI | UI | Overlay position, focus behavior, paste target |

### Audio

- Built-in microphone, USB microphone, Bluetooth headset (HFP and A2DP routes), and a
  virtual audio device.
- Default device changes, device unplug/replug, device disabled, device in exclusive use,
  and muted microphone.
- Microphone privacy: global access off, desktop-app access off, and access restored
  while the app is running.
- 48 kHz and 44.1 kHz endpoints; mono and stereo; float and 16-bit mix formats.
- Capture latency, stop flush, resampling quality, buffer bounds, and zeroing after
  finalization.

### Application compatibility

| App class | Examples | Injection expectation |
|---|---|---|
| Native Win32 editors | Notepad, WordPad, Word, Excel, Outlook | Clipboard paste; UIA fast path candidate |
| Browsers | Edge, Chrome, Firefox | Clipboard paste; UIA detection only |
| Terminals | Windows Terminal/ConPTY, cmd, PowerShell, Git Bash/mintty | Clipboard paste with per-app chord; UIA not reliable |
| IDEs/editors | VS Code, Cursor, Visual Studio, JetBrains IDEs, Notepad++ | Clipboard paste; per-app chord/behavior |
| Electron apps | Slack, Teams, Discord, WeChat, QQ, Figma desktop | Clipboard paste; UIA tree varies |
| UWP apps | Windows Settings, Mail, Photos | Clipboard paste; UIA detection candidate |
| Self-drawn UIs | WeChat, Excel custom controls, WPS, Zed | Clipboard paste; avoid UIA writes |
| Secure fields | Password managers, browser password fields, Windows credential UI | No synthetic input; clipboard-only fallback |
| Elevated apps | Task Manager, admin PowerShell, services | Clipboard-only unless a separate broker is designed |
| Secure desktop | UAC prompt, lock screen | No injection; expected limitation |

### Functional, security, and packaging checks

- Hotkey registration success, conflict detection, free-binding picker, sleep/resume
  recovery, and hook timeout recovery.
- Push-to-talk press/release, cancellation on another key, and no swallowed modifier.
- Clipboard snapshot/restore; user copy during injection wins; clipboard history/Cloud
  Clipboard behavior documented.
- Secure-field detection produces zero synthetic keystrokes in a password test set.
- Elevated-target behavior is a visible copy-only fallback, not a silent failure.
- No transcript, audio, selected text, or window title in logs, crash files, or telemetry.
- No network traffic with cloud features disabled after model download.
- Installer per-user install without admin; upgrade from the previous version; uninstall
  leaves user data unless the user chooses removal.
- Signature verification on the installer, app, helper, and sidecars; SmartScreen behavior
  on a clean machine.
- x64 and arm64 native builds; no x64-emulated helper on arm64.
- Auto-update from the previous signed build; publisher-name and hash verification;
  rollback rehearsal.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Windows 10 is out of support (EOS 2025-10-14) and 22H2 is final | High | Medium | Make Windows 11 primary; test Windows 10 22H2 best-effort; document limitations; revisit support policy before release |
| UIPI blocks injection into elevated apps, and SendInput may not report it | High | Medium | Do not run the helper elevated by default; detect elevation; fall back to clipboard with a visible notice; evaluate an optional elevated/UIAccess broker later |
| UI Automation is inconsistent or hangs across apps | High | Medium | Use UIA for detection and a whitelisted fast path only; enforce timeouts; always fall back to clipboard paste |
| Secure desktop / UAC blocks hooks and injection | High | Low | Treat as expected; leave the transcript on the clipboard; explain in the UI |
| Clipboard managers or Cloud Clipboard capture the transcript | Medium | Medium | Transient best-effort exclusion formats; snapshot/restore; document the behavior; never claim the clipboard is private |
| Terminal paste chords differ (`Ctrl+V` vs `Ctrl+Shift+V` vs `Shift+Insert`) | High | Medium | Per-app paste map with user override; test Windows Terminal, cmd, PowerShell, mintty, VS Code |
| Hotkey conflict or low-level hook timeout / EDR interference | Medium | High | Check registration result; conflict picker; hook timeout handling; RegisterHotKey fallback; no admin requirement |
| WASAPI format/route problems (Bluetooth HFP, communications role, exclusive contention) | Medium | High | Capture mix format; core resampler; endpoint notifications; explicit errors; renderer Web Audio fallback |
| Microphone privacy settings block capture with no per-app prompt | Medium | Medium | Detect the failure; deep-link to `ms-settings:privacy-microphone`; onboarding copy; never start a session on denial |
| .NET helper size/startup/runtime issues | Medium | Medium | Self-contained publish or trimming; measure; Native AOT only after COM/UIA validation; Rust fallback |
| Rust helper COM/`unsafe` complexity and learning curve | Medium | Medium | Time-boxed spike; keep the helper small; prefer C# unless the gates require Rust |
| arm64 helper or sidecar unavailable or emulated | Medium | High | Build native arm64; test on arm64 hardware; do not ship an emulated helper |
| SmartScreen reputation and code-signing certificate timing | High | High | Sign every binary; timestamp; publish stable signed builds; document the reputation ramp; certificate available later |
| MSIX and electron-updater mixing creates two update models | Medium | Medium | NSIS for direct download; MSIX only as a separate enterprise/Store design |
| Antivirus/EDR flags a low-level keyboard hook or input injection | Medium | High | Keep the hook optional; sign the helper; provide a clipboard-only mode; test with common EDR products |
| Electron/Chromium Windows support or major upgrade breaks packaging | Medium | Medium | Pin Electron 45.x; test packaging and native loading on every major; keep the helper contract stable |
| Divergence from macOS renderer capture causes two audio paths | Medium | Medium | Keep `src/core` unchanged; document the Windows capture decision; add a follow-up doc amendment; test both paths |
| Windows testing cost (VMs, arm64 hardware, app matrix) | High | Medium | Prioritize a 12-app matrix and the security paths; use VMs for clean-install tests; defer broad app coverage to beta |
| Windows helper permissions or signature attribution differs from the app | Low | Medium | Sign the helper with the same identity; test the installed layout; verify the helper path and signature before launch |

## Open Questions

1. **Helper language:** does the C# spike meet the startup, memory, installer-delta, WASAPI,
   UIA, and clipboard gates, or does Rust/windows-rs win on footprint and reliability?
2. **Audio path:** should Windows use WASAPI in the helper as recommended, or reuse
   renderer Web Audio to avoid a second capture implementation? If WASAPI is chosen, which
   document amends AUDIO-PIPELINE.md and ARCHITECTURE.md?
3. **Push-to-talk:** is a low-level hook required for the first Windows release, or is a
   toggle hotkey sufficient? What is the default binding, and how is it tested against
   conflicts?
4. **Injection order:** is clipboard-first still correct on Windows, or does UIA work
   reliably enough in the top apps to become the default there? Which apps form the
   whitelist?
5. **Elevated apps:** is clipboard-only acceptable, or is a separate elevated/UIAccess
   broker worth the security review? If so, how is it installed and signed?
6. **Paste chords:** what is the authoritative per-app map for Windows Terminal, cmd,
   PowerShell, mintty, VS Code, JetBrains IDEs, and browsers, and how is it updated
   without telemetry?
7. **Clipboard privacy:** do the Windows exclusion formats actually suppress clipboard
   history and Cloud Clipboard across supported builds? Test with real settings.
8. **Packaging:** when does MSIX become necessary for enterprise/Store deployment, and
   does it reuse the same helper and sidecar layout? How is the update model kept
   separate from electron-updater?
9. **Signing:** OV vs EV vs Azure Trusted Signing / Microsoft Artifact Signing; who holds
   the key; how is SmartScreen reputation monitored; what is the renewal plan?
10. **Windows 10:** is Windows 10 22H2 support worth the test cost after EOS, or should
    Windows 11 be the minimum?
11. **arm64:** ship separate installers or one installer with both payloads? How are the
    helper and ASR sidecar built and tested on arm64?
12. **Auto-update:** which feed and publisher-name policy, and what is the staged-rollout
    and rollback procedure for NSIS?
13. **UIA security:** can a non-elevated UIA client reliably read elevated targets for
    secure-field detection and focus context, or is a separate broker required?
14. **IME behavior:** how do Microsoft Pinyin, Japanese, and Korean IMEs interact with
    clipboard paste and SendInput Unicode in the target app matrix?
15. **Secrets:** DPAPI current-user vs Credential Manager; which is more auditable, and
    how does the choice map to the macOS Keychain contract?
16. **Model runtime:** are the chosen transcribe.cpp/sherpa-onnx/whisper.cpp binaries
    available and tested on Windows x64 and arm64, and do they ship as signed sidecars?

## Sources

Accessed 2026-10-26. Tags: **E2** = primary project/repository artifact inspected
directly for this document; **E3** = web/third-party documentation. E3 links were checked
with a redirect-following request; status is the HTTP response observed.

### E2 — project design documents

| ID | Tag | Claim used in this document | Source |
|---|---|---|---|
| E2-1 | E2 | Electron 45 + TypeScript + React 19 + electron-vite 6 + Swift helper; Windows later is a helper swap; helper language undecided | `docs/ADR-0002-tech-stack.md` |
| E2-2 | E2 | Main/preload/renderer/core/helper ownership; Windows-later capability table; versioned IPC contract; no `process.platform` product branches | `docs/ARCHITECTURE.md` |
| E2-3 | E2 | Core owns resampling, VAD, chunking, ASR adapters, post-processing, model management, settings schema | `docs/ADR-0001-core-boundary.md`, `docs/ARCHITECTURE.md` |
| E2-4 | E2 | 16 kHz mono Int16 target; capture path is a shell port; bounded buffers; resampling in core | `docs/AUDIO-PIPELINE.md` |
| E2-5 | E2 | Clipboard-first injection on macOS; secure-field rules; helper owns OS calls; no auto-retry | `docs/TEXT-INJECTION-HOTKEYS.md` |
| E2-6 | E2 | NSIS + electron-updater + Authenticode assumed for Windows; MSIX is a later channel; direct distribution | `docs/PACKAGING-RELEASE.md` |
| E2-7 | E2 | Local-first default; no content capture; no telemetry by default; secrets in Keychain (macOS) | `docs/PRIVACY-SECURITY.md` |

### E3 — Microsoft, Electron, and vendor documentation

| ID | Tag | Claim used in this document | Source | Status |
|---|---|---|---|---|
| E3-1 | E3 | Electron application distribution guidance, including Windows packaging | https://www.electronjs.org/docs/latest/tutorial/application-distribution | 200 |
| E3-2 | E3 | Electron code-signing guidance | https://www.electronjs.org/docs/latest/tutorial/code-signing | 200 |
| E3-3 | E3 | Electron supported platforms and release support policy | https://www.electronjs.org/docs/latest/tutorial/support | 200 |
| E3-4 | E3 | UI Automation entry point (Win32) | https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32 | 200 |
| E3-5 | E3 | UI Automation security overview (secure fields, integrity, UIAccess considerations) | https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview | 200 |
| E3-6 | E3 | UI Automation client portal | https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-clientportal | 200 |
| E3-7 | E3 | .NET UI Automation overview | https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview | 200 |
| E3-8 | E3 | `AutomationElement.IsPasswordProperty` | https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.ispasswordproperty | 200 |
| E3-9 | E3 | `ValuePattern` (whole-value write) and `TextPattern` (ranges/selection) | https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.valuepattern, https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.textpattern | 200 |
| E3-10 | E3 | WASAPI overview | https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi | 200 |
| E3-11 | E3 | Capturing a stream with WASAPI | https://learn.microsoft.com/en-us/windows/win32/coreaudio/capturing-a-stream | 200 |
| E3-12 | E3 | Audio endpoint devices and device roles | https://learn.microsoft.com/en-us/windows/win32/coreaudio/audio-endpoint-devices, https://learn.microsoft.com/en-us/windows/win32/coreaudio/device-roles | 200 |
| E3-13 | E3 | Device properties and endpoint IDs | https://learn.microsoft.com/en-us/windows/win32/coreaudio/device-properties | 200 |
| E3-14 | E3 | Device formats and shared-mode mix format | https://learn.microsoft.com/en-us/windows/win32/coreaudio/device-formats | 200 |
| E3-15 | E3 | `IAudioClient::Initialize` shared/exclusive mode | https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclient-initialize | 200 |
| E3-16 | E3 | `IMMDeviceEnumerator` and device-change notifications | https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nn-audiopolicy-iaudiosessionenumerator | 200 |
| E3-17 | E3 | `RegisterHotKey` (global hotkey registration; conflict return) | https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey | 200 |
| E3-18 | E3 | `SendInput`; UIPI-blocked input may not report an error | https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput | 200 |
| E3-19 | E3 | Low-level keyboard hook and `LowLevelHooksTimeout` | https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc | 200 |
| E3-20 | E3 | `SetWindowsHookEx` | https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowshookexw | 200 |
| E3-21 | E3 | Foreground window and GUI thread focus APIs | https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow, https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getguithreadinfo | 200 |
| E3-22 | E3 | User Interface Privilege Isolation (UIPI) and window features | https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features | 200 |
| E3-23 | E3 | `ChangeWindowMessageFilterEx` (not a substitute for injection privileges) | https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-changewindowmessagefilterex | 200 |
| E3-24 | E3 | Clipboard usage, formats, and sequence numbers | https://learn.microsoft.com/en-us/windows/win32/dataxchg/using-the-clipboard | 200 |
| E3-25 | E3 | Text Services Framework overview | https://learn.microsoft.com/en-us/windows/win32/tsf/text-services-framework | 200 |
| E3-26 | E3 | MSIX overview | https://learn.microsoft.com/en-us/windows/msix/ | 200 |
| E3-27 | E3 | MSIX package signing overview | https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview | 200 |
| E3-28 | E3 | App Installer file overview and MSIX update model | https://learn.microsoft.com/en-us/windows/msix/app-installer/app-installer-file-overview | 200 |
| E3-29 | E3 | `signtool` for Authenticode signing and verification | https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool | 200 |
| E3-30 | E3 | Microsoft Defender SmartScreen reputation behavior | https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/ | 200 |
| E3-31 | E3 | NSIS installer system | https://nsis.sourceforge.io/ | 200 |
| E3-32 | E3 | electron-builder NSIS target and Windows installer configuration | https://www.electron.build/nsis | 200 |
| E3-33 | E3 | windows-rs repository (Microsoft-maintained Rust bindings) | https://github.com/microsoft/windows-rs | 200 |
| E3-34 | E3 | windows-rs generated documentation | https://microsoft.github.io/windows-docs-rs/ | 200 |
| E3-35 | E3 | .NET Native AOT deployment overview | https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/ | 200 |
| E3-36 | E3 | NAudio (MIT) audio library for .NET | https://github.com/naudio/NAudio | 200 |
| E3-37 | E3 | C++/WinRT documentation | https://learn.microsoft.com/en-us/windows/uwp/cpp-and-winrt-apis/ | 200 |
| E3-38 | E3 | C#/WinRT projections | https://github.com/microsoft/CsWinRT | 200 |
| E3-39 | E3 | Windows on ARM overview | https://learn.microsoft.com/en-us/windows/arm/ | 200 |
| E3-40 | E3 | Windows 10 Home and Pro lifecycle: end of support 2025-10-14; 22H2 is the final version | https://learn.microsoft.com/en-us/lifecycle/products/windows-10-home-and-pro | 200 |
| E3-41 | E3 | Windows privacy documentation (Settings > Privacy & security > Microphone) | https://learn.microsoft.com/en-us/windows/privacy/ | 200 |
| E3-42 | E3 | Electron Windows distribution and packaging context | https://www.electronjs.org/docs/latest/tutorial/application-distribution | 200 |

Link-verification notes:

- The seeded links in the card all returned HTTP 200 on 2026-10-26: Electron application
  distribution, Microsoft UI Automation entry point, WASAPI, RegisterHotKey, MSIX, NSIS,
  and windows-rs.
- Several older Microsoft paths returned 404 and were not used:
  `dotnet/desktop/wpf/advanced/ui-automation-overview` (the framework overview path is
  used instead), Win32 `uiauto-supporttextpattern` and `uiauto-supportvaluepattern`,
  Win32 `secauthz/uiaccess`, Win32 `seccrypto/signed-code`, and
  `windows/apps/develop/capabilities/microphone`. The document cites the verified
  replacement pages instead.
- `https://crates.io/crates/windows` returned HTTP 403 to a command-line request, so it is
  not cited; the windows-rs GitHub repository and generated documentation are cited.
- Microsoft Learn pages are client-rendered; the HTTP status confirms reachability, and
  the claims are from the page content and the project's reading of the documentation.
  Re-check exact wording before implementing.
- The Windows microphone privacy settings path is a user-facing OS path; the exact
  per-build labels are verified in the testing matrix, not assumed here.

## Decision Status and Pre-Launch Self-Review

**Frozen for this card:**

- Docs-only Windows strategy; no Windows implementation.
- Electron UI and `src/core` reuse is the baseline.
- Helper language is a recommendation after a spike; C#/.NET is the leading candidate.
- WASAPI capture is the recommended Windows audio path, with renderer Web Audio as the
  fallback.
- Clipboard + `Ctrl+V` is the default injection path; UIA is an opt-in fast path.
- Electron `globalShortcut` is the baseline toggle; a low-level hook is a later
  push-to-talk capability.
- NSIS + electron-updater + Authenticode is the direct-download path; MSIX is later.
- Windows 11 x64/arm64 is primary; Windows 10 22H2 x64 is best-effort.
- Direct distribution; code-signing certificate available later.

**Recommendation summary:** reuse the Electron shell and core; add a small C# (or Rust)
Windows helper implementing the same contract; capture with WASAPI shared mode and
resample in `src/core`; inject with clipboard paste by default and UIA only where proven;
register a toggle hotkey with Electron and add a low-level hook for push-to-talk later;
ship a signed NSIS installer with electron-updater; support Windows 11 x64/arm64 as primary
and Windows 10 22H2 best-effort.

**Pre-launch self-review:** passed. The document is English, docs-only, cites E2/E3
sources, distinguishes recommendations from frozen decisions, does not claim a Windows
implementation exists, and is consistent with the accepted ADRs and design baselines.
The main open decisions are explicitly listed rather than hidden.
