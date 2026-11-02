import path from 'node:path'
import { findModel, findRuntime, type ModelCatalog } from '../../core/asr/model-catalog'
import type { SelectableAsrProviderId } from '../../shared/ipc'

export interface AsrPaths {
  modelsDir: string
  cliPath: string
  modelPath: string
  runtimeId: string
  modelId: string
}

export const QWEN3_MODEL_ID = 'qwen3-asr-0.6b-q8'
export const SENSEVOICE_MODEL_ID = 'sensevoice-small-q8'
export const PRIMARY_RUNTIME_ID = 'transcribe.cpp-0.4.1'

export const MODEL_ID_BY_PROVIDER: Record<SelectableAsrProviderId, string> = {
  qwen3: QWEN3_MODEL_ID,
  sensevoice: SENSEVOICE_MODEL_ID
}

function modelPathOverride(
  provider: SelectableAsrProviderId,
  env: NodeJS.ProcessEnv
): string | undefined {
  if (provider === 'qwen3') return env.JUSTSPEAK_QWEN3_MODEL
  return env.JUSTSPEAK_SENSEVOICE_MODEL
}

/**
 * Where the weights live.
 *
 * In a packaged app `appRoot` is the path *inside* `app.asar` — read-only, and
 * not a directory at all — so a first-run download cannot write there. Packaged
 * builds therefore read and write weights under the user's data directory; a
 * dev checkout keeps everything in the gitignored `models/` next to the source,
 * which is what `pnpm setup:asr` prepares. The runtime is different: packaged
 * builds execute it from `Contents/Resources/runtime` (see
 * `packagedRuntimeDir`), while a checkout runs it from `models/`.
 */
export function resolveModelsDir(input: {
  appRoot: string
  userDataDir: string
  packaged: boolean
}): string {
  return input.packaged
    ? path.join(input.userDataDir, 'models')
    : path.join(input.appRoot, 'models')
}

/**
 * A packaged app ships the runtime next to its resources, because both
 * `app.getAppPath()` and the repository tree are unreachable from an installed
 * bundle. The staging script flattens the CLI and its dylibs into one
 * directory, so packaged resolution uses the catalog's binary name only.
 */
export function packagedRuntimeDir(resourcesPath: string): string {
  return path.join(resourcesPath, 'runtime')
}

export function resolveAsrPaths(
  appRoot: string,
  catalog: ModelCatalog,
  env: NodeJS.ProcessEnv = process.env,
  provider: SelectableAsrProviderId = 'qwen3',
  explicitModelsDir?: string,
  explicitRuntimeDir?: string
): AsrPaths {
  const model = findModel(catalog, MODEL_ID_BY_PROVIDER[provider])
  const runtime = findRuntime(catalog, PRIMARY_RUNTIME_ID)
  const modelsDir = explicitModelsDir ?? path.join(appRoot, 'models')

  // `buildDir` is appRoot-relative ("models/runtime/transcribe.cpp"); the
  // runtime lives under the models directory, so a relocated models dir moves
  // the runtime with it.
  // The catalog is JSON, so a `buildDir` may use either separator regardless of
  // the host. Splitting normalises it to the host's separator instead of
  // trusting `path.sep` to match the catalog.
  const runtimeParts = runtime.buildDir.split(/[\\/]/)
  const runtimeDir =
    runtimeParts[0] === 'models'
      ? path.join(modelsDir, ...runtimeParts.slice(1))
      : path.join(appRoot, runtime.buildDir)

  // An explicit runtime directory is the flat packaged layout; the catalog's
  // `build/bin/...` path would point inside the read-only asar.
  const cliPath =
    env.JUSTSPEAK_TRANSCRIBE_CLI ??
    path.join(
      explicitRuntimeDir ?? runtimeDir,
      explicitRuntimeDir ? path.basename(runtime.binary) : runtime.binary
    )

  return {
    modelsDir,
    cliPath,
    modelPath:
      modelPathOverride(provider, env) ??
      path.join(modelsDir, model.files[0]?.path ?? model.id),
    runtimeId: runtime.id,
    modelId: model.id
  }
}
