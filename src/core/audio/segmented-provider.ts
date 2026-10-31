import type {
  AsrCapabilities,
  AsrErrorCode,
  AsrModelDescriptor,
  AsrProvider,
  AudioInput,
  ProviderError,
  ProviderHealth,
  ProviderResult,
  ProviderWarning,
  TranscribeOptions,
  TranscriptionResult
} from '../asr/types'
import type { SegmenterOptions, SpeechSegment } from './segmenter'
import { SEGMENTED_MAX_SESSION_SAMPLES, segmentPcm } from './segmenter'

export const SEGMENT_FAILURE_CODE = 'SEGMENT_FAILED'
export const NO_SPEECH_CODE = 'NO_SPEECH'

/**
 * Same ADR-0003 retry policy the session applies to a single utterance:
 * one same-provider retry for these codes and nothing else. It is duplicated
 * here rather than imported because the session controller is outside this
 * change's file scope; the segmented path must not weaken the policy.
 */
const SEGMENT_RETRYABLE_CODES: ReadonlySet<AsrErrorCode> = new Set<AsrErrorCode>([
  'TIMEOUT',
  'INFERENCE_FAILED'
])

export interface SegmentTranscript {
  /** Zero-based utterance index; user-facing messages add one. */
  index: number
  startSample: number
  endSample: number
  text: string
  modelId: string
  runtimeId: string
  language?: string
  warnings: ProviderWarning[]
}

export interface SegmentFailure {
  /** Zero-based utterance index; user-facing messages add one. */
  index: number
  startSample: number
  endSample: number
  error: ProviderError
}

export interface SegmentedTranscriptionError {
  code: typeof SEGMENT_FAILURE_CODE
  message: string
  failedIndices: number[]
  failures: SegmentFailure[]
}

export interface SegmentedRunResult {
  /** Concatenated successful text, in utterance order. */
  text: string
  segments: SegmentTranscript[]
  failures: SegmentFailure[]
  /** Present when at least one segment failed; successes are still returned. */
  error?: SegmentedTranscriptionError
}

/**
 * Joins segment text without inventing space between CJK characters while
 * keeping ASCII word boundaries separate. Segment order is preserved.
 */
export function joinTranscripts(parts: readonly string[]): string {
  let joined = ''
  for (const raw of parts) {
    const part = raw.trim()
    if (part.length === 0) continue
    if (joined.length === 0) {
      joined = part
      continue
    }
    const needsSpace = /[A-Za-z0-9]$/.test(joined) && /^[A-Za-z0-9]/.test(part)
    joined += `${needsSpace ? ' ' : ''}${part}`
  }
  return joined
}

/** 1-based index in the message so a user can count the utterances they spoke. */
function describeFailures(
  failures: readonly SegmentFailure[],
  totalSegments: number
): string {
  const indices = failures.map((failure) => `第 ${failure.index + 1} 段`).join('、')
  const reasons = failures
    .map((failure) => `${failure.error.code}: ${failure.error.message}`)
    .join('；')
  return `${indices}（共 ${totalSegments} 段）转写失败：${reasons}`
}

function asProviderError(error: unknown): ProviderError {
  return {
    code: 'INFERENCE_FAILED',
    message: error instanceof Error ? error.message : String(error),
    retryable: false
  }
}

async function transcribeOneSegment(
  provider: AsrProvider,
  segment: SpeechSegment,
  options: TranscribeOptions
): Promise<ProviderResult<TranscriptionResult>> {
  const input: AudioInput = {
    pcm: segment.pcm,
    sampleRate: 16000,
    channels: 1,
    durationMs: Math.round((segment.pcm.length / 16000) * 1000)
  }

  let result: ProviderResult<TranscriptionResult>
  try {
    result = await provider.transcribe(input, options)
    if (
      !result.ok &&
      result.error.retryable &&
      SEGMENT_RETRYABLE_CODES.has(result.error.code)
    ) {
      result = await provider.transcribe(input, options)
    }
  } catch (error) {
    result = { ok: false, error: asProviderError(error) }
  }
  return result
}

/**
 * Transcribes segments strictly sequentially, so call order and concatenation
 * order match utterance order. A failed segment never discards earlier or
 * later successes: its index and sample range are returned in `failures`, and
 * the caller can decide whether to surface the partial text.
 */
export async function transcribeSegments(
  provider: AsrProvider,
  segments: SpeechSegment[],
  options: TranscribeOptions = {}
): Promise<SegmentedRunResult> {
  const transcripts: SegmentTranscript[] = []
  const failures: SegmentFailure[] = []

  for (const segment of segments) {
    const result = await transcribeOneSegment(provider, segment, options)
    if (result.ok) {
      transcripts.push({
        index: segment.index,
        startSample: segment.startSample,
        endSample: segment.endSample,
        text: result.value.text,
        modelId: result.value.modelId,
        runtimeId: result.value.runtimeId,
        language: result.value.language,
        warnings: result.value.warnings
      })
    } else {
      failures.push({
        index: segment.index,
        startSample: segment.startSample,
        endSample: segment.endSample,
        error: result.error
      })
    }
  }

  const run: SegmentedRunResult = {
    text: joinTranscripts(transcripts.map((segment) => segment.text)),
    segments: transcripts,
    failures
  }
  if (failures.length > 0) {
    run.error = {
      code: SEGMENT_FAILURE_CODE,
      message: describeFailures(failures, segments.length),
      failedIndices: failures.map((failure) => failure.index),
      failures
    }
  }
  return run
}

export interface SegmentedAsrProviderConfig {
  provider: AsrProvider
  segmenter?: SegmenterOptions
  /**
   * Called when a partial result is about to be returned as a success. The
   * provider contract cannot carry text and an error together, so this is the
   * main process's seam for telling the user which segment was lost.
   */
  onPartialFailure?: (error: SegmentedTranscriptionError) => void
  now?: () => number
}

/**
 * Opt-in provider adapter. It implements the frozen AsrProvider contract and
 * never changes the default single-shot provider; see
 * `createTranscriptionProvider`.
 */
export class SegmentedAsrProvider implements AsrProvider {
  readonly id: string
  readonly capabilities: AsrCapabilities

  private readonly provider: AsrProvider
  private readonly segmenter: SegmenterOptions
  private readonly onPartialFailure?: (error: SegmentedTranscriptionError) => void
  private readonly now: () => number

  constructor(config: SegmentedAsrProviderConfig) {
    this.provider = config.provider
    this.segmenter = config.segmenter ?? {}
    this.onPartialFailure = config.onPartialFailure
    this.now = config.now ?? Date.now
    this.id = `${config.provider.id}+vad-segments`
    this.capabilities = {
      ...config.provider.capabilities,
      streaming: false,
      vad: true,
      maxAudioMs: Math.min(
        config.provider.capabilities.maxAudioMs,
        Math.round((SEGMENTED_MAX_SESSION_SAMPLES / 16000) * 1000)
      )
    }
  }

  async prepare(model: Parameters<AsrProvider['prepare']>[0]): Promise<void> {
    await this.provider.prepare(model)
  }

  async dispose(): Promise<void> {
    await this.provider.dispose()
  }

  async health(): ReturnType<AsrProvider['health']> {
    return this.provider.health()
  }

  async transcribe(
    input: AudioInput,
    options: TranscribeOptions
  ): Promise<ProviderResult<TranscriptionResult>> {
    const startedAt = this.now()

    // ADR-0003 cancellation and max-audio are part of the frozen provider
    // contract: a wrapper around another adapter must honour them too, before
    // any segmentation work or inner provider call.
    if (options.signal?.aborted) {
      return {
        ok: false,
        error: { code: 'CANCELLED', message: '转写已取消。', retryable: false }
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

    const declaredMs = Number.isFinite(input.durationMs) ? input.durationMs : 0
    const actualMs = (input.pcm.length / input.sampleRate) * 1000
    if (Math.max(declaredMs, actualMs) > this.capabilities.maxAudioMs) {
      return {
        ok: false,
        error: {
          code: 'AUDIO_TOO_LONG',
          message: `音频超过 ${Math.round(this.capabilities.maxAudioMs / 1000)} 秒上限。`,
          retryable: false
        }
      }
    }

    // Cap any caller-supplied bound at the session limit: opting into
    // segmentation must never let more than 120 s reach the provider.
    const segmentation = segmentPcm(input.pcm, {
      ...this.segmenter,
      maxSessionSamples: Math.min(
        this.segmenter.maxSessionSamples ?? SEGMENTED_MAX_SESSION_SAMPLES,
        SEGMENTED_MAX_SESSION_SAMPLES
      )
    })
    if (!segmentation.ok) {
      return {
        ok: false,
        error: {
          code: segmentation.error.code === 'AUDIO_TOO_LONG' ? 'AUDIO_TOO_LONG' : 'INFERENCE_FAILED',
          message: segmentation.error.message,
          retryable: false
        }
      }
    }

    if (segmentation.segments.length === 0) {
      return {
        ok: true,
        value: {
          text: '',
          latencyMs: this.now() - startedAt,
          modelId: this.id,
          runtimeId: this.provider.id,
          warnings: [{ code: NO_SPEECH_CODE, message: '没有检测到语音。' }]
        }
      }
    }

    const run = await transcribeSegments(this.provider, segmentation.segments, options)

    if (run.segments.length === 0 && run.error) {
      // A run cancelled before any segment succeeded is a cancellation, not an
      // inference failure; the error taxonomy drives the UI toast.
      const cancelled =
        run.failures.length > 0 &&
        run.failures.every((failure) => failure.error.code === 'CANCELLED')
      return {
        ok: false,
        error: {
          code: cancelled ? 'CANCELLED' : 'INFERENCE_FAILED',
          message: run.error.message,
          retryable: false
        }
      }
    }

    const warnings: ProviderWarning[] = run.segments.flatMap((segment) => segment.warnings)
    if (run.error) {
      warnings.push({ code: SEGMENT_FAILURE_CODE, message: run.error.message })
      this.onPartialFailure?.(run.error)
    }

    const first = run.segments[0]
    return {
      ok: true,
      value: {
        text: run.text,
        language: first?.language,
        latencyMs: this.now() - startedAt,
        modelId: first?.modelId ?? this.id,
        runtimeId: first?.runtimeId ?? this.provider.id,
        warnings,
        fallbackUsed: false
      }
    }
  }
}

/**
 * `single` is the historical one-shot path, `vad` forces segmentation, and
 * `auto` — the default — uses the one-shot path whenever the utterance fits the
 * selected provider's own limit and segments only when it does not. Short
 * dictation therefore keeps exactly the results it had before segmentation
 * existed, while a provider with a 30-second ceiling (SenseVoice) stops failing
 * on longer speech.
 */
export type TranscriptionMode = 'single' | 'vad' | 'auto'

/**
 * Returns the inner provider unchanged for the default single-shot mode. That
 * identity is deliberate: the default path must keep exactly one provider call
 * and this adapter must not be able to alter it.
 */
export class AutoAsrProvider implements AsrProvider {
  readonly id: string
  readonly capabilities: AsrCapabilities

  constructor(
    private readonly provider: AsrProvider,
    private readonly segmented: SegmentedAsrProvider
  ) {
    this.id = provider.id
    this.capabilities = provider.capabilities
  }

  prepare(model: AsrModelDescriptor): Promise<void> {
    return this.provider.prepare(model)
  }

  health(): Promise<ProviderHealth> {
    return this.provider.health()
  }

  dispose(): Promise<void> {
    return this.provider.dispose()
  }

  transcribe(
    input: AudioInput,
    options: TranscribeOptions
  ): Promise<ProviderResult<TranscriptionResult>> {
    const maxSamples = Math.floor((this.capabilities.maxAudioMs / 1000) * input.sampleRate)
    if (input.pcm.length <= maxSamples) return this.provider.transcribe(input, options)
    return this.segmented.transcribe(input, options)
  }
}

export function createTranscriptionProvider(
  provider: AsrProvider,
  mode: TranscriptionMode,
  options: Omit<SegmentedAsrProviderConfig, 'provider'> = {}
): AsrProvider {
  if (mode === 'single') return provider
  const segmented = new SegmentedAsrProvider({ provider, ...options })
  if (mode === 'vad') return segmented
  return new AutoAsrProvider(provider, segmented)
}
