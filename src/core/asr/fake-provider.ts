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

const DEMO_TEXT = '你好，这是 JustSpeak 的演示。Hello from JustSpeak.'

export class FakeAsrProvider implements AsrProvider {
  readonly id = 'fake-asr'
  readonly capabilities = CAPABILITIES

  async prepare(_model: AsrModelDescriptor): Promise<void> {}

  async transcribe(
    input: AudioInput,
    _options: TranscribeOptions
  ): Promise<ProviderResult<TranscriptionResult>> {
    const startedAt = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 350))
    const result: TranscriptionResult = {
      text: DEMO_TEXT,
      language: 'mixed',
      latencyMs: Date.now() - startedAt,
      modelId: 'fake-asr',
      runtimeId: 'fake',
      warnings: [],
      fallbackUsed: false
    }
    void input
    return { ok: true, value: result }
  }

  async dispose(): Promise<void> {}

  async health(): Promise<ProviderHealth> {
    return { status: 'ready', modelId: 'fake-asr' }
  }
}
