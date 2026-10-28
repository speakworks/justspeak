import type { AsrCapabilities, AsrModelDescriptor } from './types'
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
}

export class SenseVoiceAsrProvider extends InferenceProvider {
  constructor(config: SenseVoiceProviderConfig) {
    super({
      id: SENSEVOICE_PROVIDER_ID,
      model: config.model,
      runner: config.runner,
      capabilities: config.capabilities ?? SENSEVOICE_CAPABILITIES,
      now: config.now,
      defaultTimeoutMs: config.defaultTimeoutMs
    })
  }
}
