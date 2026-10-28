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

export function resolveAsrPaths(
  appRoot: string,
  catalog: ModelCatalog,
  env: NodeJS.ProcessEnv = process.env,
  provider: SelectableAsrProviderId = 'qwen3'
): AsrPaths {
  const model = findModel(catalog, MODEL_ID_BY_PROVIDER[provider])
  const runtime = findRuntime(catalog, PRIMARY_RUNTIME_ID)
  const modelsDir = path.join(appRoot, 'models')

  return {
    modelsDir,
    cliPath:
      env.JUSTSPEAK_TRANSCRIBE_CLI ??
      path.join(appRoot, runtime.buildDir, runtime.binary),
    modelPath:
      modelPathOverride(provider, env) ??
      path.join(modelsDir, model.files[0]?.path ?? model.id),
    runtimeId: runtime.id,
    modelId: model.id
  }
}
