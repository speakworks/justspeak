import type { AsrCapabilities, AsrModelDescriptor } from './types'
import {
  InferenceProvider,
  type AsrRunner,
  type AsrRunnerResult
} from './inference-provider'

export type Qwen3RunnerResult = AsrRunnerResult
export type Qwen3Runner = AsrRunner

export const QWEN3_PROVIDER_ID = 'qwen3-asr-0.6b-q8'

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

export class Qwen3AsrProvider extends InferenceProvider {
  constructor(config: Qwen3ProviderConfig) {
    super({
      id: QWEN3_PROVIDER_ID,
      model: config.model,
      runner: config.runner,
      capabilities: config.capabilities ?? QWEN3_CAPABILITIES,
      now: config.now,
      defaultTimeoutMs: config.defaultTimeoutMs
    })
  }
}
