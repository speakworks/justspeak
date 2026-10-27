import type {
  AsrCapabilities,
  AsrModelDescriptor,
  AsrProvider,
  AudioInput,
  ProviderHealth,
  ProviderResult,
  TranscribeOptions,
  TranscriptionResult
} from './types'

const CAPABILITIES: AsrCapabilities = {
  languages: ['zh', 'en', 'mixed'],
  streaming: false,
  punctuation: true,
  itn: true,
  timestamps: false,
  vad: false,
  maxAudioMs: 87 * 60 * 1000,
  quantizations: ['fake']
}

export const FAKE_DEMO_TEXT = '你好，这是 JustSpeak 的演示。Hello from JustSpeak.'

export interface FakeAsrProviderOptions {
  delayMs?: number
  text?: string
}

export class FakeAsrProvider implements AsrProvider {
  readonly id = 'fake-asr'
  readonly capabilities = CAPABILITIES

  private readonly delayMs: number
  private readonly text: string

  constructor(options: FakeAsrProviderOptions = {}) {
    this.delayMs = options.delayMs ?? 350
    this.text = options.text ?? FAKE_DEMO_TEXT
  }

  async prepare(_model: AsrModelDescriptor): Promise<void> {}

  async transcribe(
    input: AudioInput,
    options: TranscribeOptions
  ): Promise<ProviderResult<TranscriptionResult>> {
    const startedAt = Date.now()

    if (options.signal?.aborted) {
      return {
        ok: false,
        error: { code: 'CANCELLED', message: 'Transcription cancelled', retryable: false }
      }
    }

    if (
      !(input.pcm instanceof Int16Array) ||
      input.sampleRate !== 16000 ||
      input.channels !== 1
    ) {
      return {
        ok: false,
        error: {
          code: 'INFERENCE_FAILED',
          message: 'Audio must be 16 kHz mono PCM16',
          retryable: false
        }
      }
    }

    if (options.languageHint && !this.capabilities.languages.includes(options.languageHint)) {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_LANGUAGE',
          message: `Unsupported language hint: ${options.languageHint}`,
          retryable: false
        }
      }
    }

    const actualDurationMs = (input.pcm.length / 16000) * 1000
    if (Math.max(input.durationMs, actualDurationMs) > this.capabilities.maxAudioMs) {
      return {
        ok: false,
        error: {
          code: 'AUDIO_TOO_LONG',
          message: `Audio exceeds ${Math.round(this.capabilities.maxAudioMs / 1000)}s`,
          retryable: false
        }
      }
    }

    if (this.delayMs > 0) {
      const cancelled = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), this.delayMs)
        options.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            resolve(true)
          },
          { once: true }
        )
      })
      if (cancelled) {
        return {
          ok: false,
          error: { code: 'CANCELLED', message: 'Transcription cancelled', retryable: false }
        }
      }
    }

    // The fake never invents text for an empty capture.
    const text = input.pcm.length === 0 ? '' : this.text
    return {
      ok: true,
      value: {
        text,
        language: 'mixed',
        latencyMs: Date.now() - startedAt,
        modelId: 'fake-asr',
        runtimeId: 'fake',
        warnings: [],
        fallbackUsed: false
      }
    }
  }

  async dispose(): Promise<void> {}

  async health(): Promise<ProviderHealth> {
    return { status: 'ready', modelId: 'fake-asr' }
  }
}
