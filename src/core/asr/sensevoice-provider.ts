import type {
  AsrCapabilities,
  AsrModelDescriptor,
  AudioInput,
  ProviderResult,
  TranscribeOptions,
  TranscriptionResult
} from './types'
import {
  InferenceProvider,
  type AsrRunner,
  type AsrRunnerResult
} from './inference-provider'

export type SenseVoiceRunnerResult = AsrRunnerResult
export type SenseVoiceRunner = AsrRunner

export const SENSEVOICE_PROVIDER_ID = 'sensevoice-small-q8'

/**
 * Upstream feeds SenseVoice 30-second windows via VAD and documents that longer
 * audio is accepted only with degraded accuracy. Declaring the trained window
 * as the hard limit keeps the capability honest instead of advertising the
 * runtime's permissive fallback.
 */
export const SENSEVOICE_MAX_AUDIO_MS = 30_000

/**
 * -54 dBFS RMS gate for the whole utterance. Speech RMS is typically
 * -30 to -20 dBFS and even a quiet room tone usually sits near -60 dBFS, so
 * -54 dBFS only catches digital silence and near-silence. The pinned model
 * emits a short hallucinated token on such input ("그。" on 1 s of zeros)
 * where Qwen3 returns empty text; this gate makes both adapters agree without
 * invoking the runtime. Override per instance for tests or tuning.
 */
export const SENSEVOICE_SILENCE_RMS_THRESHOLD = 0.002

export const SENSEVOICE_CAPABILITIES: AsrCapabilities = {
  languages: ['zh', 'yue', 'en', 'ja', 'ko'],
  streaming: false,
  punctuation: true,
  itn: true,
  timestamps: false,
  vad: false,
  maxAudioMs: SENSEVOICE_MAX_AUDIO_MS,
  quantizations: ['Q8_0']
}

export interface SenseVoiceProviderConfig {
  model: AsrModelDescriptor
  runner: SenseVoiceRunner
  capabilities?: AsrCapabilities
  now?: () => number
  defaultTimeoutMs?: number
  /** RMS below this value is treated as no speech; defaults to the constant. */
  silenceRmsThreshold?: number
}

/** RMS of Int16 PCM normalized to [-1, 1]. */
function pcmRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0
  let sumSquares = 0
  for (let i = 0; i < pcm.length; i += 1) {
    const sample = pcm[i] / 32768
    sumSquares += sample * sample
  }
  return Math.sqrt(sumSquares / pcm.length)
}

export class SenseVoiceAsrProvider extends InferenceProvider {
  private readonly silenceRmsThreshold: number

  constructor(config: SenseVoiceProviderConfig) {
    super({
      id: SENSEVOICE_PROVIDER_ID,
      model: config.model,
      runner: config.runner,
      capabilities: config.capabilities ?? SENSEVOICE_CAPABILITIES,
      now: config.now,
      defaultTimeoutMs: config.defaultTimeoutMs
    })
    this.silenceRmsThreshold = config.silenceRmsThreshold ?? SENSEVOICE_SILENCE_RMS_THRESHOLD
  }

  /**
   * Never spawn the runtime for silence: the model invents a token instead of
   * returning empty text. The gate stays inside the provider so callers keep
   * seeing the ordinary success result with a warning.
   */
  protected override beforeInference(
    input: AudioInput,
    _options: TranscribeOptions,
    startedAt: number
  ): ProviderResult<TranscriptionResult> | undefined {
    // An empty capture keeps the existing empty-array path (the runner decides).
    if (input.pcm.length === 0) return undefined
    if (pcmRms(input.pcm) >= this.silenceRmsThreshold) return undefined

    return {
      ok: true,
      value: {
        text: '',
        latencyMs: this.now() - startedAt,
        modelId: this.model.id,
        runtimeId: this.model.runtime,
        warnings: [
          {
            code: 'NO_SPEECH',
            message: 'Audio is below the silence threshold; no speech was sent to the model.'
          }
        ],
        fallbackUsed: false
      }
    }
  }
}
