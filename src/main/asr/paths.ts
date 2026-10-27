import path from 'node:path'
import { findModel, findRuntime, type ModelCatalog } from '../../core/asr/model-catalog'

export interface AsrPaths {
  modelsDir: string
  cliPath: string
  modelPath: string
  runtimeId: string
  modelId: string
}

export const PRIMARY_MODEL_ID = 'qwen3-asr-0.6b-q8'
export const PRIMARY_RUNTIME_ID = 'transcribe.cpp-0.4.1'

export function resolveAsrPaths(
  appRoot: string,
  catalog: ModelCatalog,
  env: NodeJS.ProcessEnv = process.env
): AsrPaths {
  const model = findModel(catalog, PRIMARY_MODEL_ID)
  const runtime = findRuntime(catalog, PRIMARY_RUNTIME_ID)
  const modelsDir = path.join(appRoot, 'models')

  return {
    modelsDir,
    cliPath:
      env.JUSTSPEAK_TRANSCRIBE_CLI ??
      path.join(appRoot, runtime.buildDir, runtime.binary),
    modelPath:
      env.JUSTSPEAK_QWEN3_MODEL ??
      path.join(modelsDir, model.files[0]?.path ?? 'qwen3-asr-0.6b/Qwen3-ASR-0.6B-Q8_0.gguf'),
    runtimeId: runtime.id,
    modelId: model.id
  }
}
