export interface AudioInput {
  pcm: Int16Array
  sampleRate: 16000
  channels: 1
  durationMs: number
}

export interface AsrCapabilities {
  languages: string[]
  streaming: boolean
  punctuation: boolean
  itn: boolean
  timestamps: boolean
  vad: boolean
  /** True when the adapter forwards `--vocabulary` as a decode-time bias. */
  vocabularyBias: boolean
  maxAudioMs: number
  quantizations: string[]
}

export interface ProviderWarning {
  code: string
  message: string
}

/**
 * One successful utterance inside a segmented result. Times are milliseconds
 * from the start of the capture and are derived from the 16 kHz sample range.
 */
export interface TranscriptSegmentMeta {
  /** Zero-based utterance index, preserving the segmenter's order. */
  index: number
  startMs: number
  durationMs: number
}

export interface TranscriptionResult {
  text: string
  language?: string
  latencyMs: number
  modelId: string
  runtimeId: string
  warnings: ProviderWarning[]
  fallbackUsed?: boolean
  fallbackFrom?: string
  /**
   * Present only when a segmented path produced two or more successful
   * segments. Providers that do not segment leave it absent; a segmented run
   * never fabricates entries for failed segments.
   */
  segments?: TranscriptSegmentMeta[]
}

export type AsrErrorCode =
  | 'MODEL_MISSING'
  | 'MODEL_LOAD_FAILED'
  | 'UNSUPPORTED_LANGUAGE'
  | 'AUDIO_TOO_LONG'
  | 'INFERENCE_FAILED'
  | 'TIMEOUT'
  | 'CANCELLED'

export interface ProviderError {
  code: AsrErrorCode
  message: string
  retryable: boolean
  cause?: unknown
}

export type ProviderResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProviderError }

export interface AsrModelDescriptor {
  id: string
  version: string
  runtime: string
  files: Array<{ path: string; sha256: string; sizeBytes: number }>
  sizeBytes: number
  license: string
  sourceUrl: string
  quantization: string
  capabilities: AsrCapabilities
}

export interface TranscribeOptions {
  languageHint?: string
  punctuation?: boolean
  itn?: boolean
  vocabulary?: string[]
  timeoutMs?: number
  signal?: AbortSignal
  providerOptions?: Record<string, unknown>
}

export interface ProviderHealth {
  status: 'ready' | 'loading' | 'unavailable' | 'error'
  modelId?: string
  message?: string
  sinceMs?: number
}

export interface AsrProvider {
  readonly id: string
  readonly capabilities: AsrCapabilities
  prepare(model: AsrModelDescriptor): Promise<void>
  transcribe(input: AudioInput, options: TranscribeOptions): Promise<ProviderResult<TranscriptionResult>>
  dispose(): Promise<void>
  health(): Promise<ProviderHealth>
}
