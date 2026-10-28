import { FakeAsrProvider } from '../../core/asr/fake-provider'
import { findModel, toModelDescriptor } from '../../core/asr/model-catalog'
import type { ModelCatalog, ModelCatalogEntry } from '../../core/asr/model-catalog'
import { Qwen3AsrProvider } from '../../core/asr/qwen3-provider'
import { SenseVoiceAsrProvider } from '../../core/asr/sensevoice-provider'
import type { AsrModelDescriptor, AsrProvider } from '../../core/asr/types'
import type { SelectableAsrProviderId } from '../../shared/ipc'
import { TranscribeCliRunner } from './cli-runner'
import type { AsrMode } from './mode'
import { MODEL_ID_BY_PROVIDER, resolveAsrPaths, type AsrPaths } from './paths'

export interface BuildProviderOptions {
  mode: AsrMode
  appRoot: string
  catalog: ModelCatalog
  env?: NodeJS.ProcessEnv
}

export type BuiltProvider =
  | { ok: true; mode: 'fake'; provider: AsrProvider }
  | {
      ok: true
      mode: SelectableAsrProviderId
      provider: AsrProvider
      model: ModelCatalogEntry
      descriptor: AsrModelDescriptor
      paths: AsrPaths
    }
  | { ok: false; message: string }

/**
 * One construction point for every provider. Callers pass the resolved mode
 * and never branch on a provider id themselves.
 */
export function buildProvider(options: BuildProviderOptions): BuiltProvider {
  const { mode, appRoot, catalog, env } = options

  if (mode === 'fake') {
    return { ok: true, mode, provider: new FakeAsrProvider() }
  }

  const providerId: SelectableAsrProviderId = mode
  let model: ModelCatalogEntry
  try {
    model = findModel(catalog, MODEL_ID_BY_PROVIDER[providerId])
  } catch (error) {
    return {
      ok: false,
      message: `模型目录缺少 ${providerId} 条目：${error instanceof Error ? error.message : String(error)}`
    }
  }

  const descriptor = toModelDescriptor(model)
  const paths = resolveAsrPaths(appRoot, catalog, env, providerId)
  const runner = new TranscribeCliRunner({
    cliPath: paths.cliPath,
    modelPath: paths.modelPath,
    modelId: descriptor.id,
    label: model.name
  })

  const provider =
    providerId === 'qwen3'
      ? new Qwen3AsrProvider({ model: descriptor, runner })
      : new SenseVoiceAsrProvider({ model: descriptor, runner })

  return { ok: true, mode, provider, model, descriptor, paths }
}
