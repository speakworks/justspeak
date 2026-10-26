# Packaging, Signing, and Release Design for JustSpeak v0.1

- Status: Accepted design baseline for v0.1 (signing identity, release operations, and
  signing/notarization spike pending)
- Date: 2026-10-26
- Decision owner: FD2008
- Depends on: [ADR-0002: Technology stack](ADR-0002-tech-stack.md),
  [ARCHITECTURE.md](ARCHITECTURE.md), [ASR-RESEARCH.md](ASR-RESEARCH.md),
  [PRIVACY-SECURITY.md](PRIVACY-SECURITY.md), [AUDIO-PIPELINE.md](AUDIO-PIPELINE.md),
  [TEXT-INJECTION-HOTKEYS.md](TEXT-INJECTION-HOTKEYS.md)
- Scope: build and packaging tooling, macOS signing and notarization, auto-update, model
  distribution, release process, and the Windows-later outline.
- Excludes: application code, installer implementation, CI pipeline implementation, and
  the Windows packaging card. No code, packages, builds, or signing runs are included in
  this document.

Evidence tags: **E2** = primary artifact inspected directly for this document (repository
file, project design document, package manifest, official configuration schema).
**E3** = web/third-party (vendor documentation, framework documentation, platform
documentation). Sources were accessed on 2026-10-26 and link status was checked; see
[Sources](#sources).

## Context and Frozen Decisions

JustSpeak v0.1 is a direct-distribution macOS dictation application built with Electron
45, TypeScript, React 19, electron-vite 6, and a small Swift helper. The user presses a
hotkey, speaks, and clean text appears at the cursor of the focused application. The
default ASR path is local and offline after the model is downloaded; cloud providers are
optional and BYOK.

The packaging design inherits these decisions:

| Decision | Source | Consequence for this document |
|---|---|---|
| Electron 45 + electron-vite 6 + React 19 + Swift helper | ADR-0002 | The packaging layer must accept electron-vite output and sign a nested native helper. |
| macOS first; Windows later through a helper swap | ADR-0002 | v0.1 is macOS-only; Windows packaging is a separate card, but the update and release model must not block it. |
| Direct distribution; no Mac App Store in v0.1 | Card frozen decision; TEXT-INJECTION-HOTKEYS.md | Developer ID signing and notarization, not App Store review or sandboxing. |
| Local ASR models are not bundled in the base installer | ASR-RESEARCH.md R5 | First-run model download, checksums, and an offline install path are required. |
| Accessibility and microphone permissions are part of the product | AUDIO-PIPELINE.md; TEXT-INJECTION-HOTKEYS.md | The signed build must preserve TCC identity and explain both permission flows. |
| Auto-update, signing, and release are separate from app logic | ARCHITECTURE.md; PRIVACY-SECURITY.md T6 | Update and signing are main-process concerns, with no renderer privileges. |
| Apple Developer account available before public release | Card frozen decision | Developer ID Application certificate and notarytool credentials can be provisioned then. |
| No paid CI assumed | Card frozen decision | The release path must work on free GitHub Actions for a public repository and have a local fallback. |
| Windows packaging is a separate card | Card frozen decision | NSIS/MSIX and Windows signing are outlined here only as future work. |

Frozen for this card:

- Docs-only; compare packaging and release options.
- The stack is Electron 45 + electron-vite 6; the packaging layer may be chosen, but the
  build tool must not be replaced.
- Direct distribution is the v0.1 channel; Mac App Store is out of scope.
- The exact signing identity and CI provider are later decisions; this document defines
  the requirements they must satisfy.
- Windows packaging is not implemented in v0.1.

## Options

### Build tooling

The frozen stack already fixes **electron-vite 6** as the build tool for main, preload,
and renderer. The real choice is the packaging/signing/update layer around it. Two
credible options exist, plus two variants that are rejected early.

#### Option A — electron-vite 6 + electron-builder

**Shape.** electron-vite produces `out/main`, `out/preload`, and `out/renderer`.
electron-builder packages those outputs into a `.app`, signs nested code, creates DMG and
ZIP artifacts, notarizes and staples the app, and generates update metadata.
electron-updater is the matching runtime update client.

**Maturity.** electron-builder is one of the two long-standing Electron packaging tools.
It has broad production use, an active issue tracker, and configuration coverage for
macOS, Windows, and Linux. The project has been through multiple Electron major cycles,
which matters because signing and notarization behavior changes with Xcode and macOS.

**Native module handling.** electron-builder runs `@electron/rebuild` for native Node
modules, supports `asarUnpack` for files that must remain outside the archive, and
supports `extraResources` for the Swift helper and ASR sidecar binaries. JustSpeak's
design deliberately keeps native code out of the Electron main process: the Swift helper
and the transcribe.cpp sidecar are separate executables. That reduces ABI work, but those
executables still must be signed, hardened, and placed correctly in `Contents/MacOS` or
`Contents/Resources`.

**Notarization.** electron-builder has first-class macOS notarization through
`mac.notarize`, using `@electron/notarize` and Apple's `notarytool`. Current
electron-builder documentation states that it staples the ticket to the app bundle
automatically when notarization is enabled. It also documents the required Developer ID
Application certificate, hardened runtime, entitlements, and either Apple ID
app-specific-password or App Store Connect API key credentials. This is the shortest
configuration path from a signed app to a stapled app.

**Auto-update.** electron-builder produces the update metadata consumed by
electron-updater (`latest-mac.yml`, file hashes, sizes). The publishing providers include
GitHub Releases, generic HTTPS, and S3-compatible storage. This is the only option where
packaging and update metadata are produced by the same tool and tested together.

**Config complexity.** A single declarative configuration (YAML or the `build` key in
`package.json`) covers targets, signing, notarization, publishing, and update metadata.
The trade-off is a large option surface and defaults that can hide behavior. Signing and
notarization failures sometimes surface as opaque tool output, so the release job needs
explicit verification steps rather than trusting a successful exit code.

**Fit with the frozen stack.** High. electron-vite's documentation and ecosystem commonly
pair with electron-builder; the two tools do not compete for the same responsibility.

#### Option B — electron-vite 6 + Electron Forge

**Shape.** Electron Forge is the official Electron tooling. It uses makers (DMG, ZIP,
Squirrel.Windows, WiX MSI, MSIX) and publishers (GitHub, S3, and others) composed in
`forge.config.js`. With Forge, the usual Vite path is `@electron-forge/plugin-vite`, not
electron-vite.

**Maturity.** Forge is maintained by the Electron organization and has good defaults for
new applications. Its plugin and maker ecosystem is smaller than electron-builder's, and
complex signing or update layouts often require custom hooks.

**Native module handling.** Forge rebuilds native modules through its Electron rebuild
integration and supports `packagerConfig.asar` and `extraResource`. The helper and sidecar
would be handled as extra resources. This is workable; it is not materially better than
electron-builder for JustSpeak's out-of-process native design.

**Notarization.** Forge supports macOS signing and notarization through
`packagerConfig.osxSign` and `osxNotarize`, or through `@electron/notarize` in a hook.
The primitives are the same as electron-builder's, but the wiring is the application's
responsibility. There is no single `notarize: true` switch with automatic stapling.

**Auto-update.** Forge's common path is `update-electron-app`, which uses the free
`update.electronjs.org` service for public repositories and Squirrel.Mac on macOS. It is
simple, but it offers less control over feed hosting, metadata, channels, and staged
rollout. A custom feed or electron-updater can be added, at which point Forge is no longer
providing the update story.

**Config complexity.** Configuration is JavaScript/TypeScript composition: makers,
publishers, plugins, and hooks. This is flexible and testable, but it is more code to own
than a declarative builder configuration. Pairing Forge with electron-vite is not a
first-class combination; Forge expects its own Vite plugin.

**Fit with the frozen stack.** Low to medium. Forge can package electron-vite output, but
it duplicates or replaces part of the frozen build pipeline, and its update path is weaker
for a staged, self-hosted release process.

#### Option C — Replace electron-vite with Forge's Vite plugin

Rejected. It would change the frozen build tool and the development pipeline for a
packaging concern. The card freezes electron-vite 6, and the migration risk is not
justified by a packaging comparison.

#### Option D — electron-vite + electron-packager + custom scripts

Rejected. electron-packager produces an app bundle but does not provide the full signing,
notarization, DMG, and update-metadata workflow. Building that by hand adds maintenance
and failure modes that electron-builder already covers.

### macOS distribution options

#### Developer ID signing, hardened runtime, and notarization (chosen path)

A Developer ID Application certificate signs the app and all nested executables. Hardened
runtime is enabled. The app is submitted to Apple's notary service, the ticket is stapled,
and Gatekeeper accepts it on first launch while online or offline. This is the standard
direct-distribution path and the only one compatible with the frozen "no Mac App Store"
decision.

#### Mac App Store (rejected for v0.1)

The App Store path requires App Sandbox, App Store review, a different signing identity,
and restrictions that conflict with the product's Accessibility-based injection and
out-of-process helper design. It is not a v0.1 channel. If it is revisited, it is a
separate product and packaging decision, not a target added to this pipeline.

#### Unsigned or ad-hoc builds (rejected for public release)

Unsigned and ad-hoc builds are useful for local development but are blocked by Gatekeeper
on other machines, cannot be notarized, and have unstable TCC identities. They must never
be published as a release artifact.

#### Artifact formats

| Format | Role | Advantages | Costs |
|---|---|---|---|
| **DMG** | Human download and install | Familiar macOS install experience; can carry a background, license, and drag-to-Applications layout; can be signed and notarized | Mount/unmount step; not the format Squirrel.Mac consumes |
| **ZIP** | Auto-update payload and fallback download | Required by Squirrel.Mac; preserves the app bundle; simple to verify | No install UI; users must move the app manually |
| **PKG** | Installer with scripts or system-wide placement | Can run pre/post-install scripts and place files in protected locations | Unnecessary for a single `.app` in `/Applications`; more signing and notarization surface; harder to uninstall |

**Recommendation:** ship both a DMG (primary human download) and a ZIP (update payload and
fallback). Do not ship a PKG in v0.1. Both artifacts contain the same signed, hardened,
notarized app bundle.

#### Architecture

| Approach | Advantages | Costs |
|---|---|---|
| **Separate arm64 and x64 artifacts** | Smaller downloads; each sidecar binary matches one architecture; simpler to debug | Two builds and two update entries; Intel users must pick the right download |
| **Universal artifact** | One download for all Macs; simpler release notes | Roughly doubles app size; every native binary, including the Swift helper and ASR sidecar, must be universal or merged; more signing and testing work |

**Recommendation:** ship arm64 and x64 artifacts initially, with arm64 as the default
download. The ASR sidecar is a prebuilt binary, so universal builds add a lipo/merge step
that is not justified before release data shows demand. Revisit universal after v0.1 if
download and support data justify it.

### Auto-update

#### Option A — electron-updater

electron-updater is the runtime client produced by the electron-builder project. On
macOS it uses Squirrel.Mac, which requires a signed app and a ZIP payload. It reads
`latest-mac.yml`, verifies the SHA-512 of the downloaded file, and relies on the platform
signature check before installing. It supports GitHub Releases, generic HTTPS, and
S3-compatible feeds, plus update channels.

**Advantages:** tight integration with electron-builder metadata; one release pipeline for
packaging and updates; explicit control of feed and channels; cross-platform path for the
future Windows card.

**Costs:** no built-in percentage rollout; staged rollout must be implemented by
publishing metadata progressively or by a custom feed service. macOS updates are full ZIP
downloads, not deltas. Rollback is operational, not automatic.

#### Option B — Sparkle 2

Sparkle is the mature native macOS update framework. It uses an appcast feed, EdDSA
signatures, delta updates, and phased rollout controls. It is an excellent fit for a
native Cocoa application.

**Why it is not the v0.1 choice:** Sparkle is an AppKit framework. Using it from an
Electron app requires a native bridge or a separate updater helper, plus appcast
generation and key management. That adds a second update implementation in exactly the
component that must be the most trustworthy. It also does not help the Windows-later path.
Sparkle's stronger delta and phased-rollout features do not outweigh the integration cost
for a v0.1 Electron app.

#### Option C — Manual updates only

No update client; users download a new DMG. This is the smallest implementation and has
no feed to compromise, but it leaves security fixes to user behavior and is not acceptable
for a product that handles microphone audio. It is a fallback if update infrastructure is
not ready, not the target.

**Recommendation:** electron-updater with GitHub Releases as the initial feed, behind a
small updater abstraction in the main process. Keep the feed URL fixed and non-user-
configurable. Document the update check as a network destination. Revisit a self-hosted
generic feed when staged rollout or private distribution requires it.

### Model distribution

#### Option A — Bundle models in the installer

The default model and runtime are inside the `.app` or an installer payload. The app works
offline immediately after install.

**Advantages:** no first-run download; simplest support story for air-gapped users.
**Costs:** the installer grows by the model size (the target default is up to 1 GB, and the
int8 SenseVoice artifact alone is roughly 230 MB); every model update requires an app
release; redistribution must satisfy model licenses; the update payload grows; disk usage
is imposed on every user, including those who never enable local ASR.

#### Option B — First-run download (default mechanism)

The app ships without weights. On first use of the local provider, it shows the model
name, size, license, and destination, asks for consent, then downloads over HTTPS to a
temporary path, verifies SHA-256, and atomically moves the files into the model directory.

**Advantages:** smaller installer; model updates are independent of app releases; users
choose whether to spend disk space; the download path can use resumable transfers and
mirrors.
**Costs:** requires network once; adds onboarding and error states; requires a model
catalog, checksums, and hosting; needs an explicit offline install path for air-gapped
users.

ASR-RESEARCH.md already freezes this direction (models are not bundled in the base
installer, default model download target at most 1 GB, total installed models at most
2 GB). This document turns that constraint into a distribution design.

#### Option C — Hybrid: first-run download plus offline pack import (recommended shape)

The base app downloads on first run, and a separately published model pack can be imported
from disk for offline or managed installs. This is not a third mechanism; it is Option B
plus a verified import path. **Recommendation:** implement the hybrid shape: first-run
download is the default, and the offline pack is published and importable for managed or
air-gapped installs. Ship the pack when demand or a managed deployment requires it.

### Windows packaging (future)

Windows is explicitly a separate card. The design constraint here is that nothing in the
macOS release pipeline should block it.

| Option | Install UX | Auto-update | Signing | Notes |
|---|---|---|---|---|
| **NSIS** | Per-user install, no admin; familiar wizard | electron-updater NSIS path; differential downloads supported | Authenticode (OV or EV certificate, or Azure Trusted Signing) | Best fit with the electron-builder/electron-updater pipeline |
| **MSIX** | Package identity, clean install/uninstall, Store or sideload | App Installer/MSIX update path, not electron-updater | Package signing certificate; Store signing if distributed through the Store | Good for enterprise and Store; update model differs from the macOS/NSIS path |

**Recommendation for the future card:** NSIS with electron-updater for direct download,
plus Authenticode signing. Consider MSIX only for a Store or enterprise channel. Do not
mix MSIX packaging with electron-updater in the same release without a separate design.

## Comparison

Scores are 1 (worst) to 5 (best) and are the author's judgment informed by the cited
documentation, not measured benchmarks. Weights reflect the needs of a solo-maintained,
macOS-first, direct-distribution app.

### Build tooling

| Criterion | Weight | A: electron-vite + electron-builder | B: electron-vite + Forge | C: Forge Vite plugin |
|---|---:|---:|---:|---:|
| Maturity and production use | 0.15 | 5 | 4 | 4 |
| Native helper/sidecar packaging | 0.15 | 5 | 4 | 4 |
| macOS signing and notarization | 0.20 | 5 | 4 | 4 |
| Auto-update and metadata | 0.20 | 5 | 3 | 3 |
| Configuration simplicity | 0.10 | 4 | 3 | 3 |
| Fit with frozen electron-vite 6 | 0.20 | 5 | 2 | 1 |
| **Weighted total** | **1.00** | **4.90** | **3.30** | **3.10** |

Reading the matrix:

- electron-builder wins on the criteria that matter for a signed, self-updated direct
  download: notarization, update metadata, and fit with the frozen build tool.
- Forge is a credible official alternative, but its update path is simpler than JustSpeak
  needs, and using electron-vite with Forge is not a first-class combination.
- Replacing electron-vite with Forge's Vite plugin would violate the frozen stack for no
  packaging benefit.

### macOS artifact formats

| Criterion | Weight | DMG | ZIP | PKG |
|---|---:|---:|---:|---:|
| Human install experience | 0.30 | 5 | 2 | 4 |
| Squirrel.Mac/update compatibility | 0.25 | 1 | 5 | 1 |
| Signing/notarization simplicity | 0.20 | 4 | 5 | 2 |
| Uninstall and support simplicity | 0.15 | 4 | 3 | 2 |
| Enterprise deployment | 0.10 | 3 | 3 | 4 |
| **Weighted total** | **1.00** | **3.45** | **3.60** | **2.55** |

DMG and ZIP serve different jobs and score close together. ZIP is slightly ahead because
Squirrel.Mac consumes it directly; DMG is the better human download. The release should
ship both; PKG is not justified for a single app bundle.

### Auto-update

| Criterion | Weight | electron-updater | Sparkle 2 | Manual updates |
|---|---:|---:|---:|---:|
| Electron integration | 0.25 | 5 | 1 | 5 |
| Signed metadata and payload | 0.20 | 4 | 5 | 1 |
| Feed hosting flexibility | 0.15 | 5 | 4 | 1 |
| Staged/phased rollout | 0.15 | 3 | 4 | 1 |
| Delta update efficiency | 0.10 | 3 | 5 | 1 |
| Update/rollback operational control | 0.10 | 4 | 4 | 2 |
| Windows-later reuse | 0.05 | 5 | 1 | 5 |
| **Weighted total** | **1.00** | **4.20** | **3.40** | **2.30** |

electron-updater is the practical choice. Sparkle has stronger native update features but
requires a second native integration layer in the most security-sensitive component.

### Model distribution

| Criterion | Weight | Bundled | First-run download | Hybrid/offline pack |
|---|---:|---:|---:|---:|
| Offline out of the box | 0.20 | 5 | 2 | 4 |
| Installer size | 0.20 | 1 | 5 | 4 |
| Model update independence | 0.15 | 1 | 5 | 5 |
| First-run friction | 0.15 | 5 | 2 | 2 |
| Disk usage control | 0.15 | 1 | 5 | 5 |
| License/attribution control | 0.10 | 3 | 4 | 4 |
| Failure recovery | 0.05 | 4 | 3 | 3 |
| **Weighted total** | **1.00** | **2.75** | **3.75** | **3.95** |

The hybrid shape scores highest because it keeps the first-run download and adds an
offline path. Treat "first-run download plus an offline model pack" as the target: the
download is the default mechanism, and the pack is an import path for managed or
air-gapped installs. The base installer still does not bundle the weights.

### Windows packaging (future)

| Criterion | Weight | NSIS | MSIX |
|---|---:|---:|---:|
| Direct-download install UX | 0.25 | 5 | 3 |
| Auto-update fit with electron-updater | 0.25 | 5 | 1 |
| Enterprise/Store deployment | 0.20 | 2 | 5 |
| Signing and reputation path | 0.15 | 4 | 3 |
| Implementation cost for a solo developer | 0.15 | 4 | 2 |
| **Weighted total** | **1.00** | **4.10** | **2.75** |

NSIS is the default for the future Windows card; MSIX is an additional channel if a Store
or managed deployment requires it.

## Recommendation

Adopt the following for JustSpeak v0.1:

1. **Build and package with electron-vite 6 + electron-builder.** Keep electron-vite as
   the frozen build tool. Use electron-builder for the `.app`, DMG, ZIP, signing,
   notarization, and update metadata.
2. **Distribute directly with Developer ID Application signing, hardened runtime, and
   Apple notarization.** Sign every nested executable, including the Swift helper and the
   transcribe.cpp sidecar. Notarize the app, staple the ticket, and verify with Gatekeeper
   before publishing.
3. **Ship a DMG for humans and a ZIP for auto-update.** Both contain the same signed,
   notarized app. Do not ship a PKG in v0.1.
4. **Use electron-updater with GitHub Releases as the initial feed.** Keep the feed URL
   fixed, verify signatures and hashes, expose a beta channel, and treat staged rollout as
   an operational publishing process rather than a client-side percentage feature.
5. **Download models on first use, not in the installer.** Publish a pinned catalog with
   SHA-256 per file, require explicit consent, store models outside the app bundle, and
   offer a checksum-verified offline model pack.
6. **Release with semver, a changelog, signed tags, checksums, and a written rollback
   procedure.** Use free GitHub Actions for a public repository with a local fallback.
7. **Defer Windows packaging to its own card.** Keep NSIS + electron-updater as the
   assumed path and avoid choices that would make it impossible.

The recommendation is conditional on a signing/notarization spike on a signed build
before the first public release. Ad-hoc or unsigned builds do not prove TCC identity,
notarization, or auto-update behavior.

## macOS Distribution Design

### Signing identity and custody

- Use a **Developer ID Application** certificate from an Apple Developer Program team
  (not a Mac App Store certificate). The certificate is valid for direct distribution and
  notarization.
- The signing identity string is `Developer ID Application: <Team Name> (<TEAMID>)`.
  The team ID is also used for notarization credentials and helper verification.
- The private key and `.p12` export live in the maintainer's login Keychain for local
  builds. In CI they are supplied only through encrypted secrets (`CSC_LINK` as a base64
  `.p12`, `CSC_KEY_PASSWORD`). They are never committed, logged, or placed in an artifact.
- The certificate and notarization credentials are release secrets. Access is limited to
  the release environment; pull-request workflows do not receive them.
- Plan for certificate renewal and key rotation. Apple Developer certificates expire;
  a release must not be blocked by an expired certificate discovered on release day.

### Hardened runtime and entitlements

Hardened runtime is required for notarization and must be enabled for the app and for
every nested executable that Gatekeeper evaluates. The app must not carry the
`com.apple.security.get-task-allow` entitlement in a distribution build.

| Entitlement | v0.1 decision | Reason |
|---|---|---|
| `com.apple.security.cs.allow-jit` | Include | V8 in Electron needs JIT under hardened runtime. Current electron-builder notarization documentation notes that a custom entitlements file replaces the default, so this key must be retained. |
| `com.apple.security.cs.allow-unsigned-executable-memory` | Do not include | Current electron-builder guidance states this was needed by older Electron versions and is not needed by modern V8/Electron; it unnecessarily weakens hardened runtime. |
| `com.apple.security.cs.disable-library-validation` | Do not include by default | Only needed when loading frameworks or native modules signed by another team. The helper and sidecar are signed by the same team and run as separate processes. Add only with a documented reason if a signed-build spike proves it necessary. |
| `com.apple.security.cs.allow-dyld-environment-variables` | Do not include | Not needed by the design; it weakens runtime protections. |
| `com.apple.security.device.audio-input` | Not required for direct distribution | This entitlement is an App Sandbox capability. v0.1 is not sandboxed; microphone access is controlled by TCC plus `NSMicrophoneUsageDescription`. Retain this as a future Mac App Store consideration. |
| `com.apple.security.network.client` | Not required unless sandboxed | Direct-distribution apps can use the network without an entitlement. Document update and model-download destinations instead. |
| `com.apple.security.automation.apple-events` | Do not include | JustSpeak does not use Apple Events. |
| Screen Recording, Full Disk Access, Accessibility TCC exceptions | Do not include | Accessibility is a user-granted TCC permission, not an entitlement. Screen Recording and Full Disk Access are out of scope. |

The minimal entitlement set is `allow-jit` for the Electron app and no special
entitlements for the Swift helper or sidecar unless a test proves otherwise. Signing must
use the hardened runtime option and a secure timestamp for every executable.

### Info.plist keys

| Key | Value / requirement |
|---|---|
| `CFBundleIdentifier` | A stable reverse-DNS identifier (for example `com.justspeak.app`). It must not change between releases, because TCC and update identity depend on it. |
| `CFBundleShortVersionString` | The user-facing semver version, for example `0.1.0`. |
| `CFBundleVersion` | A monotonically increasing build number; do not reuse a build number for a different binary. |
| `LSMinimumSystemVersion` | Set after confirming Electron 45's supported macOS floor. Do not claim support for a version the build is not tested on. |
| `NSMicrophoneUsageDescription` | Required. Plain-language explanation: JustSpeak records audio only while dictation is active, transcribes locally by default, and uploads only when the user enables a cloud provider. |
| `NSHumanReadableCopyright` | Project copyright and license reference. |
| `NSAppleEventsUsageDescription` | Not needed; do not add permissions the app does not use. |
| Accessibility usage description | macOS does not use a usage-description key for Accessibility. The explanation belongs in the app's onboarding UI and the System Settings prompt. |

### Permission flows

#### Microphone

1. Request the microphone at the point of use (first dictation or explicit onboarding),
   not at app launch.
2. The Electron main process grants the renderer's microphone request through
   `session.setPermissionRequestHandler` and checks it with
   `session.setPermissionCheckHandler`. The renderer cannot bypass an app-level denial.
3. The Swift helper can query the authoritative status with
   `AVCaptureDevice.authorizationStatus(for:)` and report it to the UI.
4. If denied, show what is blocked, why JustSpeak needs it, and a button that deep-links
   to `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone`.
   Do not repeatedly re-prompt.
5. Development builds and signed builds can have different TCC identities. Test the
   permission flow on a signed, notarized build, and use a clean user account or VM for
   release verification.

#### Accessibility

1. Accessibility is needed for text injection (posting the paste keystroke) and for any
   focused-application context the current feature set uses. It is a TCC permission, not
   an entitlement, and the user grants it in System Settings.
2. Request it at the point of first injection or in an explicit permission onboarding
   step. Explain that it lets JustSpeak insert text into the app the user is already
   using, and that it does not read screen content in v0.1.
3. The helper checks trust with `AXIsProcessTrustedWithOptions` and can request the
   system prompt. The app then deep-links to
   `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility` and
   polls trust status while the window is open.
4. The signed helper must have a stable code-signing identity and be signed by the same
   team as the app. Re-signing or replacing the helper can invalidate trust; the release
   process must not change helper signing casually.
5. If permission is revoked while running, stop injection, keep the transcript safe, and
   show a recovery path. Do not crash or silently paste into the wrong place.

#### Input Monitoring

Input Monitoring is only for the later Fn/Right Option event-tap upgrade. It is not a v0.1
permission. Do not request it speculatively; a permission prompt the app does not need is
a trust cost and a privacy risk.

#### TCC verification in release testing

- Verify the microphone and Accessibility prompts on a clean macOS user account using the
  signed, notarized build.
- Verify that the prompt attributes to JustSpeak (not an unsigned helper or a terminal).
- Verify deny, revoke, and re-grant paths, including app restart.
- Record the tested macOS versions. TCC behavior varies across releases.

### Build and sign order

Sign from the inside out:

1. Build the Swift helper and ASR sidecar for the target architecture. Sign each with the
   Developer ID Application identity, hardened runtime, and a secure timestamp.
2. Build the Electron app with electron-vite and assemble the `.app` with
   electron-builder. Place the helper and sidecar in the locations the runtime expects
   (`Contents/MacOS` or `Contents/Resources`, per the architecture's IPC contract).
3. Sign Electron frameworks and other nested Mach-O code with the same identity.
4. Sign the outer `.app`.
5. Verify with `codesign --verify --deep --strict --verbose=2` and inspect the nested
   signatures. Do not use `codesign --deep` as a signing strategy; it is acceptable only
   as a verification convenience.
6. Notarize and staple the app.
7. Create the DMG and ZIP from the stapled app. Sign the DMG, notarize and staple it if it
   is submitted separately, and verify the ZIP contains the same signed app.

All Mach-O binaries inside the app bundle, including the helper and sidecar, must be
signed and hardened before notarization. An unsigned nested executable is a common cause
of notarization failure.

### DMG and ZIP

**DMG:** create from the signed, stapled app. Include a drag-to-Applications layout. Sign
the DMG with the same Developer ID identity. If the DMG is submitted to notarization,
staple the ticket to the DMG as well. Verify with `spctl --assess --type open` and
`xcrun stapler validate`. The DMG is the primary download on the website and the release
page.

**ZIP:** create from the same signed, stapled app. The ZIP itself is not code-signed in
the way a bundle is, but the app inside must remain signed and notarized. Squirrel.Mac
consumes the ZIP for auto-update; the ZIP is also a fallback for users who cannot mount a
DMG. Verify by extracting to a clean directory and running the Gatekeeper assessment.

Do not build the DMG or ZIP from a different app copy than the one that was notarized and
stapled. Rebuilding after notarization invalidates the ticket.

### Notarization and stapling

- Use `notarytool` through `@electron/notarize`/electron-builder. Prefer App Store Connect
  API key credentials in CI (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) over
  an Apple ID and app-specific password; the API key is easier to scope and rotate.
- Submit the signed app, wait for acceptance, and staple the ticket to the app bundle.
  electron-builder's notarization support staples the app automatically when enabled; the
  release job must still verify the staple.
- If the DMG is notarized separately, staple the DMG after acceptance and verify it.
- Keep the notarization log for a failed submission. Common causes are an unsigned nested
  binary, a missing hardened runtime, an invalid entitlement, or a stale/expired
  certificate.
- Do not publish an artifact while notarization is pending. A failed notarization is a
  release blocker, not a warning.

### Gatekeeper verification

Run these checks on the final artifacts before publishing:

- `codesign --verify --deep --strict --verbose=2 JustSpeak.app`
- `spctl --assess --type execute --verbose=4 JustSpeak.app`
- `xcrun stapler validate JustSpeak.app`
- `spctl --assess --type open --context context:primary-signature -v JustSpeak.dmg`
- `xcrun stapler validate JustSpeak.dmg` if the DMG was notarized separately
- Extract the ZIP and repeat the app checks
- Launch on a clean macOS user account with the network disabled to confirm the stapled
  ticket works offline

### Release-blocking macOS checks

1. App and every nested executable are signed with Developer ID Application.
2. Hardened runtime is enabled and `get-task-allow` is absent.
3. Entitlements match the table above; any additional entitlement has a written reason.
4. `NSMicrophoneUsageDescription` is present and accurate.
5. Notarization succeeded and the app (and DMG, if submitted) is stapled.
6. Gatekeeper assessment passes on a clean account.
7. Microphone and Accessibility flows work on the signed build.
8. Auto-update from the previous release succeeds with the signed ZIP.
9. The release artifact hash matches the published checksum.

## Auto-Update Design

### Feed and metadata

- The update client is electron-updater in the Electron main process. The renderer never
  talks to the update feed.
- The initial feed is GitHub Releases in the public repository. electron-builder publishes
  `latest-mac.yml` (and channel-specific metadata) with version, file URLs, sizes, and
  SHA-512 hashes. A generic HTTPS or S3 feed can replace GitHub later without changing the
  client contract.
- The feed URL is fixed in the build. It is not user-editable, and the app never accepts
  an arbitrary update URL.
- Update checks are a documented network destination. In a fully offline configuration,
  the app does not check for updates unless the user enables update checks. This is
  consistent with the privacy design's "no telemetry by default" and documented network
  destinations.
- Check on launch and on a low-frequency interval. Do not check during an active
  dictation session or while the ASR model is downloading.

### Signature verification

- macOS: Squirrel.Mac requires a signed app and verifies the code signature before
  installation. The ZIP must contain the signed, hardened, notarized app.
- Metadata: electron-updater verifies the SHA-512 recorded in `latest-mac.yml`. Do not
  disable hash verification.
- Windows later: configure the expected publisher name so the updater verifies the
  Authenticode signer, not just the hash.
- The update metadata and payload are served over HTTPS. HTTPS is necessary but not
  sufficient; the signature and hash checks are the trust boundary.
- Future hardening: signed update metadata (a detached signature over `latest-mac.yml`)
  and key custody outside the CI account. This is a known gap in PRIVACY-SECURITY.md T6
  and should be tracked as a security follow-up.

### Staged rollout

electron-updater exposes channels, not a built-in percentage rollout. The v0.1 process:

1. Publish a `beta` channel first. Opt-in users and maintainers test it.
2. Publish the `latest` metadata only after the beta passes the release checklist.
3. For a wider staged rollout, publish metadata to a controlled feed segment or use a
   server-side rule to serve `latest-mac.yml` to a percentage of clients. GitHub Releases
   alone cannot express a percentage, so this requires a small feed service or a manual
   staged publication.
4. Keep the previous release's metadata and artifacts available throughout the rollout.

Do not ship a client-side random percentage gate as the only rollout control. It is hard
to audit and does not stop a bad build from reaching a cohort.

### Rollback

electron-updater does not provide automatic rollback, and `allowDowngrade` should remain
false by default. The operational rollback is:

1. Stop the rollout: mark the bad release as a pre-release or remove its update assets
   from the feed so new clients do not see it.
2. Restore the previous `latest-mac.yml` (or repoint the feed to the previous release).
3. Publish a fixed patch version as soon as possible. Never reuse a version number.
4. Keep the previous DMG and ZIP published so users can reinstall manually.
5. Verify the rollback path from the bad version on a test machine, including the
   signature and hash checks.

A manual downgrade is possible by installing the older signed DMG, but user data and
settings migrations must be forward-compatible enough to tolerate it. If a release
includes an irreversible data migration, rollback requires a migration plan, not just a
feed change.

### Update UX

- Download in the background, but install only when the app is idle and no dictation
  session is active.
- Show version, release notes summary, and a restart action. Do not restart silently while
  the user is working.
- If the update fails signature or hash verification, discard it, log a content-free
  error, and keep the current version running.
- Provide a manual "check for updates" action in settings.
- Do not couple model downloads to app updates. A model update can ship independently
  through the catalog.

## Model Distribution Design

### Catalog and download

- The model catalog is a pinned, app-served manifest: model id, version, runtime,
  architecture, file list, sizes, SHA-256 per file, license identifier, minimum app
  version, and download URL(s). The catalog is versioned with the app and is not fetched
  from an arbitrary user URL.
- The default local model is Qwen3-ASR 0.6B Q8_0 through transcribe.cpp; SenseVoice Small
  is the lightweight tier and Whisper small/medium is the multilingual fallback, subject
  to the ASR benchmark and legal gates. The catalog also supports those fallback artifacts.
- On first use, show model name, approximate download size, disk requirement, license,
  and destination. Download only after explicit consent.
- Download to a temporary directory, verify each file's size and SHA-256, then move the
  model into its final directory atomically. Never load a partially downloaded model.
- Support retry with backoff and, where the host supports it, HTTP range resume. Handle
  proxy and captive-portal failures with a clear message and a retry action.
- Check free disk space before starting. The download needs temporary headroom in addition
  to the final model size.
- The ASR sidecar has no network access. Only the Electron main process downloads models,
  consistent with ARCHITECTURE.md and PRIVACY-SECURITY.md.

### Checksums and integrity

- SHA-256 is required for every model file and for the catalog entry that references it.
  The checksum is published with the release and with the catalog.
- Verify before load and again if the model directory is imported or moved. Fail closed on
  a mismatch; do not offer a "load anyway" path.
- Pin catalog URLs to the project's hosting. Do not accept an arbitrary model URL from the
  renderer or from a settings file.
- A signed catalog is a later hardening step (PRIVACY-SECURITY.md T4). Until then, the
  catalog ships with the signed app and the per-file checksums are published in the
  release notes.
- Use HTTPS with normal certificate validation. Do not disable certificate checks for
  mirrors.
- Keep the model directory permissions least-privilege. Do not place models in the app
  bundle, which would invalidate the code signature if modified.

### Disk usage

- Default model download target: at most 1 GB. Total installed models: at most 2 GB.
- The base installer should stay well below the Electron app sizes observed in
  ADR-0002's comparison (for example, a 313.9 MB DMG that bundles models and features).
  The exact installer size is a release measurement, not a promise in this document.
- Show per-model disk usage in settings and provide a delete action that removes the model
  and its temporary files. Do not delete user history or settings when a model is removed.
- Document that model downloads and temporary files can temporarily use roughly twice the
  final model size.

### Licenses and attribution

- The app is MIT. Model and runtime licenses are separate and must be compatible with
  commercial distribution.
- SenseVoice weights use the FunASR Model Open Source License Agreement, which permits
  commercial use under its conditions and requires attribution. Include the license text
  and attribution in `THIRD-PARTY-NOTICES` and in the About window.
- sherpa-onnx is Apache-2.0; whisper.cpp is MIT. Include their notices and license texts.
- Parakeet weights are CC-BY-4.0, which requires attribution if used. Moonshine models
  under the non-commercial Community License are excluded from v0.1 distribution.
- Link to each model card and license from the model download UI. Do not bury attribution
  only in the repository.
- Release notes state which model is downloaded, its size, and its license. This is both a
  compliance requirement and a user-trust feature.

### Offline install

- Publish an optional model pack (for example, a ZIP containing the model files plus the
  catalog entry and checksums) for air-gapped or managed installs.
- The import flow verifies SHA-256 and the catalog version before installing. It does not
  skip checks because the file came from disk.
- Document the pack in the release notes and provide a checksum for the pack itself.
- The base app remains usable for settings and cloud providers without a local model, but
  local dictation requires either the download or the offline pack.

### Deletion and uninstall

- Removing the app does not silently delete models or user history. Provide an explicit
  "remove downloaded models" action and document where data lives.
- On uninstall, leave user data unless the user chooses to remove it. A future installer
  can offer cleanup, but v0.1 does not need a PKG for this.

## Release Process

### Versioning

- Use semantic versioning: `MAJOR.MINOR.PATCH`. v0.1 starts at `0.1.0`.
- Before 1.0, breaking changes may increment MINOR, but every breaking change is called
  out in the changelog and release notes. Do not silently break settings, model paths, or
  update compatibility.
- Pre-release versions use identifiers such as `0.2.0-beta.1`. A pre-release is published
  to the beta channel, not the stable feed.
- Build metadata is not part of the tag or the public version. The build number in
  `CFBundleVersion` increases monotonically.
- Never reuse a version number, even for a failed release. Publish a new patch instead.

### Changelog

- Maintain `CHANGELOG.md` in Keep a Changelog style with Added, Changed, Deprecated,
  Removed, Fixed, and Security sections under an Unreleased heading.
- Write user-facing release notes separately from the changelog. The changelog records
  changes; the release notes explain impact, installation, permissions, and known issues.
- Every security fix gets a Security entry and a release-note sentence. Do not obscure a
  security fix in a generic "bug fixes" line.

### Branches and tags

- `main` is the protected integration branch. Feature and fix branches merge through pull
  requests with review.
- For a release, create a `release/0.x` branch when stabilization starts. Tag the release
  from the release branch after the release checklist passes.
- Tags are annotated and signed: `v0.1.0`. Tag protection prevents moving or deleting a
  published release tag.
- The tag triggers the release workflow. A manual local release uses the same version and
  produces the same artifact names.
- Do not tag from an unmerged branch or from a dirty working tree.

### CI secrets

| Secret | Purpose | Scope and handling |
|---|---|---|
| `CSC_LINK` | Base64-encoded Developer ID Application `.p12` | Release environment only; never exposed to pull requests |
| `CSC_KEY_PASSWORD` | Password for the `.p12` | Release environment only; rotate with the certificate |
| `APPLE_API_KEY` | App Store Connect API key contents or path | Release environment only; preferred over Apple ID credentials |
| `APPLE_API_KEY_ID` | API key ID | Release environment only |
| `APPLE_API_ISSUER` | API issuer ID | Release environment only |
| `APPLE_TEAM_ID` | Apple Developer team ID | Not secret, but keep it in configuration for consistency |
| `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` | Alternative notarization credentials | Use only if API-key auth is unavailable; treat as secrets |
| `GH_TOKEN` | Publish GitHub Release and update assets | Least-privilege token; release environment only |

Rules:

- Secrets are stored in the CI provider's encrypted secret store, never in the repository,
  logs, artifacts, or release notes.
- Pull-request workflows do not receive signing or publishing secrets. Use a protected
  environment with required reviewers for the release job.
- Prefer short-lived or scoped credentials where the provider supports them. Rotate
  credentials after a suspected exposure.
- Do not print environment variables or full command lines that could contain a password.
- A local release uses the same environment-variable names. The maintainer is responsible
  for keeping them out of shell history and logs.

### Build and release steps

1. Start from a clean checkout of the release tag or release branch. Confirm the working
   tree is clean and the commit is the intended one.
2. Install with `npm ci` from the committed lockfile. Do not use an unpinned install in a
   release job.
3. Run the test, lint, and type-check gates. Do not package a build that failed a gate.
4. Build main, preload, and renderer with electron-vite 6.
5. Assemble and sign the app with electron-builder, including the helper and sidecar.
6. Notarize the app and staple the ticket. Verify the staple.
7. Create the DMG and ZIP from the stapled app. Sign the DMG and notarize/staple it if it
   is submitted separately.
8. Run the Gatekeeper, signature, and first-launch checks on a clean machine or VM.
9. Generate SHA-256 checksums, the SBOM, and (optionally) a build provenance attestation.
10. Publish the GitHub Release with the DMG, ZIP, `latest-mac.yml`, checksums, SBOM, and
    release notes. Mark pre-releases as pre-release; do not let them update the stable
    feed.
11. Verify the public download: fetch the artifact from the release URL, check its hash,
    and perform a first launch.
12. Perform an update test from the previous version, then announce the release.

### Artifacts and checksums

| Artifact | Required | Purpose |
|---|---|---|
| `JustSpeak-<version>-arm64.dmg` | Yes | Primary human download |
| `JustSpeak-<version>-x64.dmg` | Yes | Intel download |
| `JustSpeak-<version>-arm64-mac.zip` | Yes | Auto-update payload and fallback |
| `JustSpeak-<version>-x64-mac.zip` | Yes | Auto-update payload and fallback |
| `latest-mac.yml` (and channel metadata) | Yes | electron-updater feed metadata |
| `SHA256SUMS` | Yes | Independent artifact verification |
| `THIRD-PARTY-NOTICES` / license bundle | Yes | License compliance |
| SBOM (CycloneDX or SPDX) | Yes | Supply-chain transparency |
| Build provenance/attestation | Optional for v0.1 | Stronger supply-chain evidence when CI supports it |

Publish SHA-256 checksums next to the artifacts and repeat the checksums in the release
notes. A checksum published only inside the same compromised release page is not a strong
control, but it detects truncated or substituted downloads and supports mirror operators.
Signing the checksums (minisign, GPG, or sigstore) is a later hardening step.

### Release notes

Release notes include:

- Version and release date.
- What changed, in user-facing language.
- Installation steps and the DMG/ZIP distinction.
- Required permissions (microphone, Accessibility) and what they are used for.
- Model download size and license, or a link to the offline model pack.
- Known issues and any rollback advice.
- SHA-256 checksums for every artifact.
- The minimum supported macOS version.

Do not include secrets, internal hostnames, or personal email addresses in release notes.

### Rollback

- Keep the previous release's artifacts and `latest-mac.yml` available.
- If a release is bad, remove it from the stable feed first, restore the previous feed
  metadata, and publish a fixed patch.
- Do not delete the previous release until the new release has survived the rollout
  window and the next release is ready.
- Rehearse the rollback once before v0.1: install version N, publish a bad N+1 to a test
  feed, exercise the rollback, and verify that clients return to N.
- Security releases may need an expedited rollback and a separate advisory. Follow
  SECURITY.md for disclosure.

### No-paid-CI fallback

The assumed CI is free GitHub Actions on a public repository, using a macOS runner. If
Actions minutes, runner availability, or policy make that unsuitable, the release process
runs locally on a maintained macOS build machine with the same environment variables and
the same verification commands. The release checklist is identical; only the executor
changes. Do not make a paid CI service a hard dependency for v0.1.

### Release checklist

1. Version bumped in the app manifest and changelog; `CFBundleVersion` increased.
2. Changelog and release notes reviewed; security entries present.
3. Tests, lint, and type-check pass on the release commit.
4. Clean checkout; lockfile unchanged except for the intended dependency change.
5. Helper and sidecar built for each target architecture and signed.
6. App signed with Developer ID Application, hardened runtime, minimal entitlements.
7. `NSMicrophoneUsageDescription` present and accurate.
8. Notarization accepted; app stapled; DMG stapled if separately notarized.
9. `codesign`, `spctl`, and `stapler` checks pass on a clean machine or VM.
10. Microphone and Accessibility flows pass on the signed build.
11. Auto-update from the previous version passes; rollback path is understood.
12. SHA-256 checksums, SBOM, and license notices generated and published.
13. Release published to the correct channel; pre-release not on the stable feed.
14. Public artifact downloaded, hash checked, and launched successfully.
15. Rollback/previous artifacts retained for the support window.

### Post-release verification

- Download the public DMG and ZIP from the release URL and verify their SHA-256 values.
- Launch on a clean macOS user account with the network disabled (stapled-ticket test).
- Install the previous version and update to the new version through the public feed.
- Confirm the beta channel does not leak into the stable feed.
- Confirm the model download works, fails cleanly on a bad checksum, and can be deleted.
- Record the tested macOS versions and hardware. File any gap as a release blocker or a
  documented known issue before announcing.

## Windows Later

Windows packaging is a separate card. The outline below records the intended path so the
macOS design does not paint the project into a corner.

- **Installer:** NSIS per-user install through electron-builder, with an uninstall entry
  and a clean upgrade path. MSIX is an additional channel for Store or managed deployment,
  not the default direct-download format.
- **Signing:** Authenticode with an OV or EV certificate, or Azure Trusted Signing (now
  branded Artifact Signing). Sign the installer and all executables. Plan for SmartScreen
  reputation; a new certificate starts with little reputation.
- **Auto-update:** electron-updater's NSIS path for direct downloads, with publisher-name
  verification. MSIX uses the App Installer/MSIX update path and must not be mixed with
  electron-updater without a separate design.
- **Native helper:** the Windows helper implements the same versioned IPC contract as the
  Swift helper. The packaging design must sign it and place it beside the app, not inside
  the asar archive.
- **Models:** reuse the same catalog, checksums, and first-run download model. The
  transcribe.cpp sidecar is cross-platform, so the model distribution logic should not be
  macOS-specific.
- **Open issue:** whether a single release process can publish both NSIS and MSIX or
  whether MSIX belongs to a separate Store pipeline. Decide in the Windows card.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Notarization fails because a nested binary is unsigned or not hardened | Medium | High | Sign inside-out; verify every Mach-O before submission; notarize early in the release cycle, not on release day |
| TCC attributes microphone or Accessibility to the wrong binary | Medium | High | Stable bundle ID; sign the helper with the same team; test the signed build on a clean account; document the prompt behavior |
| A bad update reaches users | Medium | High | Beta channel; staged publication; signature and hash verification; retained previous artifacts; rehearsed rollback |
| Update feed or signing key is compromised | Low | High | Protect credentials in a release environment; HTTPS; fixed feed URL; plan key rotation; signed metadata as follow-up |
| Model download is tampered with or interrupted | Medium | Medium | Pin catalog URLs; SHA-256 per file; atomic install; fail closed; no arbitrary URLs |
| Model license or attribution is incomplete | Medium | High | Legal review; license texts in `THIRD-PARTY-NOTICES`; UI attribution; exclude non-commercial models |
| Installer or model disk usage hurts adoption | Medium | Medium | First-run download; show sizes; delete action; measure the installer at release |
| Electron major upgrades break signing or native helper loading | Medium | Medium | Pin Electron 45.x; test the signing pipeline on every Electron upgrade; keep the helper contract stable |
| CI secrets leak through logs or artifacts | Low | High | Protected release environment; no secrets in PR workflows; redact logs; rotate after exposure |
| Universal build complexity delays release | Medium | Low | Ship arm64 and x64 separately first; revisit universal after v0.1 |
| Gatekeeper or notarization behavior differs across macOS versions | Medium | Medium | Test the oldest supported macOS and the current release on clean accounts; record the tested matrix |
| A rollback requires an incompatible data migration | Low | High | Design settings/model migrations to be backward-tolerant; test downgrade; avoid destructive migrations in patch releases |

## Open Questions

1. **Signing identity and team ID:** which Apple Developer team and certificate will be
   used, and who holds the private key and recovery material?
2. **CI provider:** is free GitHub Actions on the public repository acceptable for the
   long term, or is a self-hosted macOS runner required? No paid CI is assumed.
3. **Architecture:** ship arm64 and x64 separately, or invest in a universal build? If
   universal, how will the Swift helper and prebuilt ASR sidecar be merged and signed?
4. **Minimum macOS version:** what is Electron 45's supported floor, and which versions
   will be tested and claimed in `LSMinimumSystemVersion`?
5. **Accessibility attribution:** does the nested Swift helper inherit the app's TCC
   identity on the target macOS versions, or does it need to be the responsible process?
   This needs a signed-build spike.
6. **Update feed:** GitHub Releases is the initial feed. When is a generic HTTPS feed or a
   small staged-rollout service needed, and who operates it?
7. **Staged rollout granularity:** is channel-based beta sufficient for v0.1, or is a
   percentage rollout required at launch? If required, what is the feed mechanism?
8. **Model catalog signing:** when will the catalog move from app-bundled checksums to a
   signed catalog, and where will the signing key live?
9. **Model hosting:** which host or CDN serves the model files, and what is the mirror and
   availability plan? The host must support HTTPS, range requests, and stable checksums.
10. **Model license wording:** has legal review confirmed the FunASR attribution and
    redistribution wording, and does the About/notices UI satisfy it?
11. **Offline model pack:** is a separately published pack in scope for v0.1, or only if
    users request it?
12. **Auto-update default:** should update checks be on by default for a local-first app,
    or opt-in along with network features? The privacy design requires documented network
    destinations, not necessarily opt-in updates.
13. **DMG notarization:** confirm whether the chosen electron-builder version notarizes and
    staples the DMG itself or only the app bundle, and document the exact commands in the
    release runbook.
14. **Windows timing:** when does the Windows packaging card start, and does it reuse the
    same release repository and feed or a separate one?
15. **Crash reporting:** v0.1 has no crash-upload provider. If one is added, it needs its
    own consent, retention, and packaging review.

## Sources

### E2 — repository design documents

| ID | Claim used in this document | Source |
|---|---|---|
| E2-1 | Electron 45 + TypeScript + React 19 + electron-vite 6 + Swift helper; packaging, signing, and auto-update are separate decisions | `docs/ADR-0002-tech-stack.md` Decision and "Explicitly not decided here" |
| E2-2 | Core boundary and main-process ownership of auto-update, model management, and OS integration | `docs/ARCHITECTURE.md` component table and "Ownership" table |
| E2-3 | Models are not bundled; default download at most 1 GB; total models at most 2 GB; checksum and offline requirements | `docs/ASR-RESEARCH.md` requirements R5, R7, R11 and Recommendation |
| E2-4 | Model license findings: SenseVoice/FunASR, sherpa-onnx Apache-2.0, whisper.cpp MIT, Parakeet CC-BY-4.0, Moonshine non-commercial exclusion | `docs/ASR-RESEARCH.md` License Findings and runtime table |
| E2-5 | Update signing, notarization, model-download integrity, TCC least privilege, and rollback are threat-model items | `docs/PRIVACY-SECURITY.md` T4, T5, T6, T7, T11 |
| E2-6 | Microphone permission needs `NSMicrophoneUsageDescription`, main-process permission handlers, and a signed-build TCC test | `docs/AUDIO-PIPELINE.md` "Permissions" and failure table |
| E2-7 | Clipboard + Cmd+V is the v0.1 injection default; Accessibility is required for the native path; no Mac App Store sandbox | `docs/TEXT-INJECTION-HOTKEYS.md` frozen decisions and Option I1 |

### E3 — platform and tool documentation

All links were checked on 2026-10-26. Status is the HTTP response observed with a
redirect-following request.

| ID | Tag | Claim used in this document | Source | Status |
|---|---|---|---|---|
| E3-1 | E3 | electron-builder is a complete packaging solution with auto-update support | https://www.electron.build/ | 200 |
| E3-2 | E3 | electron-builder current docs: macOS configuration, DMG/NSIS targets, auto-update, code signing, notarization | https://www.electron.build/docs/mac, https://www.electron.build/docs/dmg, https://www.electron.build/docs/nsis, https://www.electron.build/docs/features/auto-update, https://www.electron.build/docs/features/code-signing/, https://www.electron.build/docs/features/code-signing/code-signing-mac, https://www.electron.build/docs/features/code-signing/notarization | 200 |
| E3-3 | E3 | electron-builder notarization requires an Apple Developer Program membership, Developer ID Application certificate, hardened runtime, entitlements, and notarytool credentials; it staples the app automatically when notarization is enabled; modern Electron does not need `allow-unsigned-executable-memory` | https://www.electron.build/docs/features/code-signing/notarization | 200 |
| E3-4 | E3 | Electron Forge is the official Electron tooling with makers and publishers; macOS signing guide; DMG, Squirrel.Windows, and WiX MSI makers; GitHub publisher | https://www.electronforge.io/, https://www.electronforge.io/guides/code-signing/code-signing-macos, https://www.electronforge.io/config/makers/dmg, https://www.electronforge.io/config/makers/squirrel.windows, https://www.electronforge.io/config/makers/wix-msi, https://www.electronforge.io/config/publishers/github | 200 |
| E3-5 | E3 | Electron application distribution and code-signing guidance | https://www.electronjs.org/docs/latest/tutorial/application-distribution, https://www.electronjs.org/docs/latest/tutorial/code-signing | 200 |
| E3-6 | E3 | Electron auto-update overview and the built-in update ecosystem | https://www.electronjs.org/docs/latest/tutorial/updates | 200 |
| E3-7 | E3 | `update-electron-app` is a drop-in auto-update module used with Forge | https://github.com/electron/update-electron-app | 200 |
| E3-8 | E3 | `@electron/notarize` provides notarization for macOS Electron apps; `@electron/rebuild` rebuilds native modules against Electron | https://github.com/electron/notarize, https://github.com/electron/rebuild | 200 |
| E3-9 | E3 | electron-vite is a build tool for Electron main/preload/renderer | https://electron-vite.org/ | 200 |
| E3-10 | E3 | Apple notarization workflow for macOS software before distribution, including stapling and ticket validation | https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution | 200 |
| E3-11 | E3 | Apple's customizable notarization workflow using `notarytool` | https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution/customizing_the_notarization_workflow | 200 |
| E3-12 | E3 | Apple hardened runtime | https://developer.apple.com/documentation/security/hardened-runtime | 200 |
| E3-13 | E3 | Apple guidance for resolving common notarization issues | https://developer.apple.com/documentation/security/resolving-common-notarization-issues | 200 |
| E3-14 | E3 | Apple audio-input entitlement, required for App Sandbox microphone access (not used in the non-sandboxed v0.1 direct build) | https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input | 200 |
| E3-15 | E3 | Apple Gatekeeper and notarization user-facing behavior | https://support.apple.com/en-us/102445 | 200 |
| E3-16 | E3 | Sparkle is a native macOS software update framework with appcast, signatures, delta updates, and phased rollout features | https://sparkle-project.org/, https://sparkle-project.org/documentation/ | 200 |
| E3-17 | E3 | MSIX documentation and Windows package deployment/update model | https://learn.microsoft.com/en-us/windows/msix/ | 200 |
| E3-18 | E3 | Microsoft Artifact Signing (formerly Azure Trusted Signing) for code signing | https://learn.microsoft.com/en-us/azure/trusted-signing/ | 200 |

Link-verification notes:

- The card's seed URL `https://www.electron.build/auto-update` returned HTTP 404 on
  2026-10-26. The current documentation path is
  `https://www.electron.build/docs/features/auto-update`; this document uses the current
  path.
- The seed URL `https://www.electron.build/code-signing` also returned HTTP 404; the
  current paths are under `https://www.electron.build/docs/features/code-signing/`.
- The npm registry page for `electron-updater` returned HTTP 403 to a command-line
  request, so it is not cited as a source. The electron-builder auto-update documentation
  covers the same claim.
- Apple and Electron documentation pages are rendered with client-side scripts; the HTTP
  status confirms reachability, and the claims cited are from the page content and the
  project's reading of the documentation. Re-check the exact wording before implementing
  the release runbook.
