## 1. Pure runtime-link validation (test-first)

- [x] 1.1 Tests: system libraries are ignored; `@rpath/<name>` is accepted; an absolute dependency is a problem; a referenced name missing from the staged set is a problem; a dylib may reference itself
- [x] 1.2 `src/core/asr/runtime-package.ts` parses `otool -L` output and returns the local name set plus problems
- [x] 1.3 Path tests: packaged resolution uses `<resources>/runtime/<binary name>`; dev resolution keeps the catalog `buildDir`

## 2. Runtime staging

- [x] 2.1 Copy the CLI and the five dylibs into a flat `resources/runtime/` using their soname filenames
- [x] 2.2 Delete every absolute `LC_RPATH` and add `@loader_path`
- [x] 2.3 Re-sign each staged binary ad-hoc
- [x] 2.4 Copy runtime license texts next to the binaries
- [x] 2.5 `--check` validates the staged links, rpaths and signatures without rebuilding
- [x] 2.6 `electron-builder.yml` ships the directory; packaging scripts run staging first; `resources/runtime/` is gitignored

## 3. Application wiring

- [x] 3.1 `buildProvider` accepts an explicit runtime directory
- [x] 3.2 Main passes `process.resourcesPath/runtime` when packaged
- [x] 3.3 Packaged `runtimeMissingHint` names reinstall/`JUSTSPEAK_TRANSCRIBE_CLI`, not `pnpm setup:asr`
- [x] 3.4 Historical hint tests still pass

## 4. Signing readiness

- [x] 4.1 `resources/entitlements.mac.plist` carries the documented minimal set (`allow-jit`)
- [x] 4.2 Pure `checkSigningEnv` unit-tested: certificate source and notarization credential pair
- [x] 4.3 `scripts/package-mac-signed.ts` fails naming missing variables, then invokes electron-builder with hardened runtime, entitlements and notarization
- [x] 4.4 `scripts/verify-mac-app.ts` checks `codesign --verify --deep --strict`, `spctl`, `stapler`, and the shipped runtime (manifest, link closure, rpaths, arm64, signatures); unsigned output is reported as unsigned, not as pass
- [x] 4.5 Docs: signing commands, env, current blockers; auto-update and crash diagnostics recorded with prerequisites

## 5. Verification

- [x] 5.1 `pnpm typecheck`, `pnpm test`, `pnpm build`, `openspec validate --specs --strict`
- [x] 5.2 Staged CLI transcribes the committed fixture against the local SenseVoice weights
- [x] 5.3 Packaged app launched with a temporary `userData` and copied weights reaches 「模型就绪」 from `Contents/Resources/runtime`
- [x] 5.4 `pnpm package:mac:artifacts` produces a DMG whose app contains `Contents/Resources/runtime/transcribe-cli`
- [x] 5.5 `scripts/verify-mac-app.ts` runs on the unsigned artifact and reports the expected unsigned status
- [x] 5.6 E2E suite still green (7/7)
