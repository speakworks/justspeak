import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  findLlmModel,
  parseLlmModelCatalog,
  type LlmModelEntry
} from '../../core/llm/model-catalog'
import type { LlmBackend, LlmPreferencesView } from '../../shared/ipc'
import { ModelManager } from '../asr/model-manager'
import { LlmCorrector, type LlmLocalStatus } from './corrector'
import { LlmKeyStore } from './key-store'

export interface LlmManagerPaths {
  appRoot: string
  resourcesPath: string
  packaged: boolean
  userDataDir: string
}

export interface LlmStoredConfig {
  backend: LlmBackend
  baseUrl: string
  model: string
}

export interface LlmManagerOptions extends LlmManagerPaths {
  fetch?: typeof fetch
  /** Forwarded from the corrector so the settings row can refresh. */
  onLocalStatusChange?: (status: LlmLocalStatus) => void
}

/**
 * Owns the optional LLM runtime: catalog, model path, download, key storage
 * and the corrector. Nothing here runs unless the user selects a backend.
 */
export class LlmManager {
  readonly catalogPath: string
  readonly model: LlmModelEntry
  readonly runtimePath: string
  readonly modelDir: string
  readonly modelPath: string
  readonly keyStore: LlmKeyStore
  readonly corrector: LlmCorrector
  private downloading = false
  private readonly fetchImpl: typeof fetch

  private constructor(options: LlmManagerOptions, model: LlmModelEntry) {
    this.catalogPath = options.packaged
      ? path.join(options.resourcesPath, 'resources/llm-models.json')
      : path.join(options.appRoot, 'resources/llm-models.json')
    this.runtimePath = options.packaged
      ? path.join(options.resourcesPath, 'llm/llama-server')
      : path.join(options.appRoot, 'resources/llm/llama-server')
    this.model = model
    this.modelDir = path.join(options.userDataDir, 'models/llm')
    this.modelPath = path.join(this.modelDir, model.file.path)
    this.fetchImpl = options.fetch ?? fetch
    this.keyStore = new LlmKeyStore(options.userDataDir)
    this.corrector = new LlmCorrector({
      runtimePath: this.runtimePath,
      localModelPath: this.modelPath,
      localModelSize: model.file.sizeBytes,
      keyStore: this.keyStore,
      fetch: this.fetchImpl,
      ...(options.onLocalStatusChange === undefined
        ? {}
        : { onLocalStatusChange: options.onLocalStatusChange })
    })
  }

  static async create(options: LlmManagerOptions): Promise<LlmManager> {
    const catalogPath = options.packaged
      ? path.join(options.resourcesPath, 'resources/llm-models.json')
      : path.join(options.appRoot, 'resources/llm-models.json')
    const catalog = parseLlmModelCatalog(JSON.parse(await readFile(catalogPath, 'utf8')))
    const first = catalog.models[0]
    if (!first) throw new Error('LLM catalog has no model')
    return new LlmManager(options, findLlmModel(catalog, first.id))
  }

  /**
   * Cheap post-download check: the verified download renames atomically into
   * place, so the expected size catches truncation without re-hashing 1.1 GB
   * on every settings read.
   */
  private modelVerified(): boolean {
    try {
      return statSync(this.modelPath).size === this.model.file.sizeBytes
    } catch {
      return false
    }
  }

  configure(config: LlmStoredConfig): void {
    this.corrector.configure({
      backend: config.backend,
      baseUrl: config.baseUrl,
      model: config.model
    })
  }

  async status(config: LlmStoredConfig): Promise<LlmPreferencesView> {
    const runtimeReady = existsSync(this.runtimePath)
    const modelReady = this.modelVerified()
    const localStatus = this.corrector.localStatus
    const hasKey = (await this.keyStore.load()) !== undefined
    let message: string | undefined
    if (this.downloading) message = '正在下载本地模型…'
    else if (config.backend === 'local') {
      if (!runtimeReady) message = '本地运行时缺失，需要重新安装或运行 pnpm package:llm。'
      else if (!modelReady) message = '本地模型尚未下载或文件不完整。'
      else if (localStatus.state === 'failed') {
        message = `本地模型未能运行：${localStatus.error ?? '未知原因'}`
      } else if (localStatus.state === 'starting') message = '本地模型正在启动…'
      else if (localStatus.state === 'ready') message = '本地模型已就绪。'
      else message = '本地模型已下载，将在下次听写时启动。'
    } else if (config.backend === 'endpoint') {
      if (config.baseUrl.trim() === '' || config.model.trim() === '') {
        message = '请填写 OpenAI 兼容服务地址和模型名。'
      } else if (!hasKey) {
        message = '未保存 API Key；本地端点通常可以留空。'
      } else {
        message = '端点已配置。'
      }
    }
    return {
      backend: config.backend,
      endpoint: { baseUrl: config.baseUrl, model: config.model, hasKey },
      local: {
        runtimeReady,
        modelReady,
        modelName: this.model.name,
        modelPath: this.modelPath,
        state: localStatus.state,
        ...(localStatus.error === undefined ? {} : { error: localStatus.error })
      },
      message
    }
  }

  async download(onProgress: (percent: number) => void): Promise<void> {
    if (this.downloading) throw new Error('模型正在下载。')
    this.downloading = true
    try {
      const manager = new ModelManager({ fetch: this.fetchImpl })
      let last = -1
      await manager.download(this.model.file, this.modelPath, {
        onProgress: ({ bytes, totalBytes }) => {
          const percent = Math.floor((bytes / totalBytes) * 100)
          if (percent >= last + 2) {
            last = percent
            onProgress(percent)
          }
        }
      })
    } finally {
      this.downloading = false
    }
  }

  async dispose(force = false): Promise<void> {
    await this.corrector.dispose(force)
  }
}
