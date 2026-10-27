import type {
  AsrCapabilities,
  AsrModelDescriptor,
  AsrProvider,
  AudioInput,
  ProviderHealth,
  ProviderResult,
  ProviderWarning,
  TranscribeOptions,
  TranscriptionResult
} from './types'
import { PCM_CHANNELS, PCM_SAMPLE_RATE } from './wav'

export interface Qwen3RunnerResult {
  text: string
  language?: string
  warnings?: ProviderWarning[]
}

/**
 * The main-process adapter owns the OS process and temporary files; the core
 * provider owns validation, cancellation, timeout, and result metadata.
 */
export interface Qwen3Runner {
  run(input: AudioInput, options: TranscribeOptions): Promise<ProviderResult<Qwen3RunnerResult>>
  health(): Promise<ProviderHealth>
  dispose(): Promise<void>
}

export const QWEN3_MAX_AUDIO_MS = 87 * 60 * 1000

export const QWEN3_CAPABILITIES: AsrCapabilities = {
  languages: ['zh', 'en', 'yue', 'mixed'],
  streaming: false,
  punctuation: true,
  itn: true,
  timestamps: false,
  vad: false,
  maxAudioMs: QWEN3_MAX_AUDIO_MS,
  quantizations: ['Q8_0']
}

export interface Qwen3ProviderConfig {
  model: AsrModelDescriptor
  runner: Qwen3Runner
  capabilities?: AsrCapabilities
  now?: () => number
  defaultTimeoutMs?: number
}

function error(
  code: 'MODEL_MISSING' | 'MODEL_LOAD_FAILED' | 'UNSUPPORTED_LANGUAGE' | 'AUDIO_TOO_LONG' | 'INFERENCE_FAILED' | 'TIMEOUT' | 'CANCELLED',
  message: string,
  retryable: boolean
): ProviderResult<never> {
  return { ok: false, error: { code, message, retryable } }
}

export class Qwen3AsrProvider implements AsrProvider {
  readonly id = 'qwen3-asr-0.6b-q8'
  readonly capabilities: AsrCapabilities

  private readonly model: AsrModelDescriptor
  private readonly runner: Qwen3Runner
  private readonly now: () => number
  private readonly defaultTimeoutMs: number
  private lastHealth: ProviderHealth = { status: 'unavailable' }
  private prepared = false

  constructor(config: Qwen3ProviderConfig) {
    this.model = config.model
    this.runner = config.runner
    this.capabilities = config.capabilities ?? QWEN3_CAPABILITIES
    this.now = config.now ?? (() => Date.now())
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 120_000
  }

  async prepare(model: AsrModelDescriptor): Promise<void> {
    this.prepared = true
    void model
    const health = await this.runner.health()
    this.lastHealth = health
    if (health.status === 'error' || health.status === 'unavailable') {
      this.prepared = false
      throw new Error(health.message ?? 'Qwen3 ASR runtime is unavailable')
    }
  }

  async transcribe(
    input: AudioInput,
    options: TranscribeOptions
  ): Promise<ProviderResult<TranscriptionResult>> {
    const startedAt = this.now()

    if (options.signal?.aborted) {
      return error('CANCELLED', 'Transcription cancelled', false)
    }
    if (
      !(input.pcm instanceof Int16Array) ||
      input.sampleRate !== PCM_SAMPLE_RATE ||
      input.channels !== PCM_CHANNELS
    ) {
      return error('INFERENCE_FAILED', 'Audio must be 16 kHz mono PCM16', false)
    }
    if (
      options.languageHint &&
      !this.capabilities.languages.includes(options.languageHint)
    ) {
      return error(
        'UNSUPPORTED_LANGUAGE',
        `Unsupported language hint: ${options.languageHint}`,
        false
      )
    }

    const actualDurationMs = (input.pcm.length / PCM_SAMPLE_RATE) * 1000
    const durationMs = Math.max(input.durationMs, actualDurationMs)
    const maxAudioMs = this.capabilities.maxAudioMs
    if (durationMs > maxAudioMs) {
      return error(
        'AUDIO_TOO_LONG',
        `Audio is ${Math.round(durationMs / 1000)}s; the limit is ${Math.round(maxAudioMs / 1000)}s`,
        false
      )
    }

    const controller = new AbortController()
    const abortFromCaller = (): void => controller.abort()
    options.signal?.addEventListener('abort', abortFromCaller, { once: true })

    let timeout: ReturnType<typeof setTimeout> | undefined
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs

    const timeoutResult = new Promise<ProviderResult<Qwen3RunnerResult>>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort()
        resolve(error('TIMEOUT', `Transcription exceeded ${timeoutMs} ms`, true))
      }, timeoutMs)
      timeout.unref?.()
    })

    const cancelledResult = new Promise<ProviderResult<Qwen3RunnerResult>>((resolve) => {
      if (!options.signal) return
      options.signal.addEventListener(
        'abort',
        () => resolve(error('CANCELLED', 'Transcription cancelled', false)),
        { once: true }
      )
    })

    let runnerResult: ProviderResult<Qwen3RunnerResult>
    try {
      runnerResult = await Promise.race([
        this.runner.run(input, { ...options, signal: controller.signal }),
        timeoutResult,
        cancelledResult
      ])
    } catch (cause) {
      runnerResult = {
        ok: false,
        error: {
          code: 'INFERENCE_FAILED',
          message: cause instanceof Error ? cause.message : String(cause),
          retryable: true,
          cause
        }
      }
    } finally {
      if (timeout) clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abortFromCaller)
    }

    if (!runnerResult.ok) return runnerResult
    if (options.signal?.aborted) {
      return error('CANCELLED', 'Transcription cancelled', false)
    }

    return {
      ok: true,
      value: {
        text: runnerResult.value.text,
        language: runnerResult.value.language,
        latencyMs: this.now() - startedAt,
        modelId: this.model.id,
        runtimeId: this.model.runtime,
        warnings: runnerResult.value.warnings ?? [],
        fallbackUsed: false
      }
    }
  }

  async dispose(): Promise<void> {
    this.prepared = false
    this.lastHealth = { status: 'unavailable', modelId: this.model.id }
    await this.runner.dispose()
  }

  async health(): Promise<ProviderHealth> {
    if (!this.prepared) {
      return this.lastHealth.status === 'ready'
        ? { ...this.lastHealth, status: 'unavailable' }
        : this.lastHealth
    }
    const health = await this.runner.health()
    this.lastHealth = health
    return health
  }
}
