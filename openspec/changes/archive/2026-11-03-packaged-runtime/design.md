## Context

The pinned runtime is built by `pnpm setup:asr` into
`models/runtime/transcribe.cpp/build/`:

| File | Size | Referenced as |
|---|---|---|
| `build/bin/transcribe-cli` | 162 KB | — |
| `build/src/libtranscribe.0.4.1.dylib` | 1.9 MB | `@rpath/libtranscribe.0.4.dylib` |
| `build/ggml/src/libggml.0.26.0.dylib` | 59 KB | `@rpath/libggml.0.dylib` |
| `build/ggml/src/libggml-cpu.0.26.0.dylib` | 959 KB | `@rpath/libggml-cpu.0.dylib` |
| `build/ggml/src/ggml-metal/libggml-metal.0.26.0.dylib` | 5.3 MB | `@rpath/libggml-metal.0.dylib` |
| `build/ggml/src/libggml-base.0.26.0.dylib` | 720 KB | `@rpath/libggml-base.0.dylib` |

Every binary carries two `LC_RPATH` entries under the build machine's checkout:
`.../build/ggml/src` and `.../build/ggml/src/ggml-metal`. Copying the tree to a
different location leaves the `@rpath` prefixes unresolved.

## Decisions

### Ship the runtime in `Contents/Resources/runtime`, not `userData`

`docs/PACKAGING-RELEASE.md` already prefers executing the runtime from the app
bundle (signed with the app) over the interim user-writable `userData` copy. The
bundle is read-only and travels with the app, so a staged flat directory is the
smallest change: `extraResources` copies `resources/runtime` to
`Contents/Resources/runtime`, and packaged resolution is
`path.join(process.resourcesPath, 'runtime')`.

Weights stay in `userData/models`: they are 253–850 MB, downloaded after consent,
and never belong in an installer.

### Flat layout, soname filenames, `@loader_path`

All six binaries go into one directory using the names their dependencies
reference (`libtranscribe.0.4.dylib`, `libggml.0.dylib`, …). Each binary's
absolute `LC_RPATH` entries are deleted and replaced with `@loader_path`, so
dyld resolves `@rpath/libggml.0.dylib` next to the loading file. One directory
removes the build tree's `build/src` + `build/ggml/src` split.

`install_name_tool` invalidates the linker's ad-hoc signature; on arm64 an
invalid signature means the process cannot start, so each file is re-signed
ad-hoc (`codesign --force --sign -`) immediately after rewriting. A later signed
build lets electron-builder re-sign the nested binaries with the Developer ID.

### Validation is pure and runs before packaging

`src/core/asr/runtime-package.ts` parses `otool -L` output and reports:

- every dependency is either a system library or `@rpath/<name>`;
- every `@rpath` name exists among the staged files;
- no absolute path outside `/usr/lib` and `/System/Library` survives.

A missing or non-relocatable dependency fails the staging step with the offending
file and reference named, rather than producing an app that dies at first use.

### Packaging requires a local runtime

`models/` is gitignored, so a fresh checkout cannot package until `pnpm
setup:asr` has built the runtime. `pnpm package:mac` therefore runs the staging
script first and fails with `run pnpm setup:asr` when the build tree is absent.
That is a build-machine requirement, not a user-facing one.

### Signing stays disabled by default, but is prepared

`electron-builder.yml` keeps `identity: null` so local builds stay unsigned. A
separate `scripts/package-mac-signed.ts` requires the release environment
(`CSC_NAME` or `CSC_LINK`+`CSC_KEY_PASSWORD`, and either `APPLE_ID` +
`APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` or the App Store Connect API key
triple), then invokes electron-builder with hardened runtime, the entitlements
file, and notarization enabled. The env check is pure and unit-tested; the
signed/notarized run itself is blocked on credentials and is recorded as such.

### Auto-update and crash diagnostics

Both are deliberately out of this change. Auto-update needs a signed app and a
release channel (`publish: null` today). Crash diagnostics needs either an
upload endpoint or a local retention/export design; packaging it as a partial
feature would create an unverified path. Both are recorded in
`docs/PRODUCT-FEEDBACK.md` with their blocking prerequisites.

## Risks

- The staged runtime is ad-hoc signed in local builds. That is enough for
  Gatekeeper on the same machine and for the trial path; it does not replace
  Developer ID signing.
- `extraResources` binaries are re-signed by electron-builder in a signed build.
  The verification script checks the final artifact instead of trusting that
  step.
- The runtime license texts must travel with the binaries; the staging script
  copies them into `resources/runtime/licenses/`, and notices already name
  transcribe.cpp's MIT license.
