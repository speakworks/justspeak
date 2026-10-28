import type {
  AsrCapabilities,
  AsrErrorCode,
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

export interface AsrRunnerResult {
  text: string
  language?: string
  warnings?: ProviderWarning[]
}

/**
 * The main-process adapter owns the OS process and temporary files; the core
 * provider owns validation, cancellation, timeout, and result metadata.
 */
export interface AsrRunner {
  run(input: AudioInput, options: TranscribeOptions): Promise<ProviderResult<AsrRunnerResult>>
  health(): Promise<ProviderHealth>
  dispose(): Promise<void>
}

export interface InferenceProviderConfig {
  id: string
  model: AsrModelDescriptor
  runner: AsrRunner
  capabilities: AsrCapabilities
  now?: () => number
  defaultTimeoutMs?: number
}

function error(code: AsrErrorCode, message: string, retryable: boolean): ProviderResult<never> {
  return { ok: false, error: { code, message, retryable } }
}

/**
 * Shared ADR-0003 adapter behavior: audio-shape and duration validation,
 * language hints, cancellation/timeout races, and result metadata. Model
 * families differ only in their runner and declared capabilities.
 */
export class InferenceProvider implements AsrProvider {
  readonly id: string
  readonly capabilities: AsrCapabilities

  protected readonly model: AsrModelDescriptor
  private readonly runner: AsrRunner
  private readonly now: () => number
  private readonly defaultTimeoutMs: number
  private lastHealth: ProviderHealth = { status: 'unavailable' }
  private prepared = false

  constructor(config: InferenceProviderConfig) {
    this.id = config.id
    this.model = config.model
    this.runner = config.runner
    this.capabilities = config.capabilities
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
      throw new Error(health.message ?? `${this.id} ASR runtime is unavailable`)
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
    if (options.languageHint && !this.capabilities.languages.includes(options.languageHint)) {
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

    const timeoutResult = new Promise<ProviderResult<AsrRunnerResult>>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort()
        resolve(error('TIMEOUT', `Transcription exceeded ${timeoutMs} ms`, true))
      }, timeoutMs)
      timeout.unref?.()
    })

    const cancelledResult = new Promise<ProviderResult<AsrRunnerResult>>((resolve) => {
      if (!options.signal) return
      options.signal.addEventListener(
        'abort',
        () => resolve(error('CANCELLED', 'Transcription cancelled', false)),
        { once: true }
      )
    })

    let runnerResult: ProviderResult<AsrRunnerResult>
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
