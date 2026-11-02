## Why

A packaged JustSpeak install cannot transcribe. `electron-builder.yml` ships only
`out/`, the catalog, notices and licenses; the pinned `transcribe-cli` and its
five ggml dylibs stay in the gitignored `models/` tree. Even copying them next to
the app does not help: every dylib's `LC_RPATH` is an absolute path into the
build machine's checkout, so dyld resolves `@rpath/libggml*.dylib` only on the
machine that built it. The 2026-10-31 trial reached 「模型就绪」 only because the
whole `models/` tree had been copied into `userData` by hand on that same
machine.

The estimator also cannot be shipped through the existing first-run download:
only model weights are downloaded, and `initializeProvider` checks the runtime
before the weights, so a clean install never gets far enough to download
anything. The runtime is ~9 MB, small enough to bundle, and bundling it is what
makes the app runnable on another Mac with no manual steps.

Signing readiness is part of the same release gap: the configuration is pinned
to unsigned (`identity: null`, `notarize: false`), but the certificate,
hardened-runtime entitlements, and verification commands are not prepared, so
provisioning credentials alone would not produce a distributable build.

## What Changes

- A staging script copies the pinned CLI and its dylibs into a flat
  `resources/runtime/` directory, rewrites each binary's absolute `LC_RPATH` to
  `@loader_path`, re-signs ad-hoc, and carries the runtime license texts.
  `electron-builder.yml` ships that directory as `Contents/Resources/runtime`.
- Packaged builds resolve the CLI from `process.resourcesPath/runtime`; a dev
  checkout keeps resolving under the repository `models/` tree. Model weights
  continue to download into `userData/models`.
- The runtime-missing hint changes for packaged builds: it no longer suggests
  `pnpm setup:asr`, which cannot repair an installed app.
- Signing readiness: a hardened-runtime entitlements file, an env-gated signed
  packaging script that fails with the missing variables named, and an artifact
  verification script (`codesign`, `spctl`, `stapler`). Signing and notarization
  stay disabled until the owner supplies a Developer ID certificate and
  notarytool credentials; those remain recorded blockers.
- Auto-update and crash diagnostics are recorded, not implemented: both need
  the signed release channel (and, for diagnostics, an upload/retention
  decision) that does not exist yet.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `asr-provider`: packaged builds resolve a bundled, relocatable runtime and
  report a packaged-specific repair hint when it is missing.

## Impact

- `src/core/asr/runtime-package.ts` (new pure validation), `src/main/asr/paths.ts`,
  `src/main/asr/providers.ts`, `src/main/asr/download-hint.ts`, `src/main/index.ts`.
- `scripts/package-runtime.ts`, `scripts/package-mac-signed.ts`,
  `scripts/verify-mac-app.ts`, `resources/entitlements.mac.plist`.
- `electron-builder.yml`, `package.json`, `.gitignore`, `tests/paths.test.ts`,
  `tests/runtime-package.test.ts`, `tests/signing-env.test.ts`.
- `docs/PACKAGING-RELEASE.md`, `docs/PRODUCT-FEEDBACK.md`,
  `THIRD_PARTY_NOTICES.md` and the shipped license texts.
- No new runtime dependency or network call: the runtime ships in the app and the
  weights download is unchanged.
