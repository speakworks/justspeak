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
 * Where the runtime and weights live.
 *
 * In a packaged app `appRoot` is the path *inside* `app.asar` — read-only, and
 * not a directory at all — so neither the shipped bundle nor a first-run
 * download can use it. Packaged builds therefore read and write under the
 * user's data directory; a dev checkout keeps everything in the gitignored
 * `models/` next to the source, which is what `pnpm setup:asr` prepares.
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

export function resolveAsrPaths(
  appRoot: string,
  catalog: ModelCatalog,
  env: NodeJS.ProcessEnv = process.env,
  provider: SelectableAsrProviderId = 'qwen3',
  explicitModelsDir?: string
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

  return {
    modelsDir,
    cliPath: env.JUSTSPEAK_TRANSCRIBE_CLI ?? path.join(runtimeDir, runtime.binary),
    modelPath:
      modelPathOverride(provider, env) ??
      path.join(modelsDir, model.files[0]?.path ?? model.id),
    runtimeId: runtime.id,
    modelId: model.id
  }
}
