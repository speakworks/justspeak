import type { AsrErrorCode, AsrProvider, AudioInput } from '../asr/types'
import type { PostprocessResult } from '../postprocess'
import type { AppState, RecordingSummary, TranscriptEvent } from '../../shared/ipc'

export const INVALID_SUMMARY_MESSAGE = '录音数据无效，请重试。'
export const CANCELLED_MESSAGE = '已取消本次录音。'

export const EMPTY_CAPTURE_MESSAGE = '没有采集到音频，请重试。'
export const CAPTURE_FAILED_MESSAGE = '录音失败，请重试。'
export const STOP_MISSING_MESSAGE = '没有收到录音停止事件，请重试。'
export const UNSUPPORTED_SAMPLE_RATE_MESSAGE = '录音采样率不受支持（需要 16 kHz），请重试。'

export type ToggleAction = 'start' | 'stop' | 'ignore'

/** ADR-0003 retry policy: one same-provider retry for transient failures. */
const RETRYABLE_CODES = new Set<AsrErrorCode>(['TIMEOUT', 'INFERENCE_FAILED'])

export interface SessionControllerDeps {
  provider: AsrProvider
  paste: (text: string) => Promise<void>
  sendState: (state: AppState, message?: string) => void
  sendTranscript: (event: TranscriptEvent) => void
  fake: boolean
  /** Deterministic cleanup between the ASR result and the paste call. */
  postprocess?: (text: string) => PostprocessResult
  getAudio?: (summary: RecordingSummary) => AudioInput | null
  now?: () => number
  startDebounceMs?: number
  transcribeTimeoutMs?: number
}

export function isRecordingSummary(value: unknown): value is RecordingSummary {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return ['durationMs', 'samples', 'sampleRate', 'rms'].every((key) => {
    const n = record[key]
    return typeof n === 'number' && Number.isFinite(n) && n >= 0
  })
}

/**
 * Main-process dictation state machine. All side effects are injected so the
 * IPC and lifecycle contract can be exercised without Electron.
 */
export class SessionController {
  state: AppState = 'idle'
  lastMessage: string | undefined

  private readonly deps: SessionControllerDeps
  private pipelineRunning = false
  private lastStartAt = 0

  constructor(deps: SessionControllerDeps) {
    this.deps = deps
  }

  get isPipelineRunning(): boolean {
    return this.pipelineRunning
  }

  toggle(rendererReady: boolean): ToggleAction {
    const now = (this.deps.now ?? Date.now)()

    if (this.state === 'recording') {
      this.setState('transcribing')
      return 'stop'
    }
    if (this.state !== 'idle' && this.state !== 'error') return 'ignore'
    if (!rendererReady) return 'ignore'
    if (now - this.lastStartAt < (this.deps.startDebounceMs ?? 300)) return 'ignore'

    this.lastStartAt = now
    this.setState('recording')
    return 'start'
  }

  /**
   * Cancelling is only meaningful while capturing. It short-circuits the chain
   * (`recording → idle`) instead of entering `transcribing`, so the capture is
   * discarded and nothing reaches the provider, the transcript, or the
   * clipboard. Every other state ignores it — the same choice VoiceInk makes
   * when its recorder close button is pressed during transcription.
   */
  cancel(): 'cancel' | 'ignore' {
    if (this.state !== 'recording') return 'ignore'
    this.setState('idle', CANCELLED_MESSAGE)
    return 'cancel'
  }

  handleCaptureStarted(_atMs: number): void {
    // Timestamp logging stays in main; the state machine already armed.
  }

  /** Startup/provider-selection failures are visible and retryable from error. */
  fail(message: string): void {
    this.enterError(message)
  }

  async handleCaptureStopped(summary: unknown): Promise<void> {
    if (this.state !== 'transcribing') {
      // Stale stop events are ignored without touching state or transcripts.
      return
    }
    if (!isRecordingSummary(summary)) {
      this.enterError(INVALID_SUMMARY_MESSAGE)
      return
    }
    if (summary.sampleRate !== 16000) {
      this.enterError(UNSUPPORTED_SAMPLE_RATE_MESSAGE)
      return
    }

    const audio = this.deps.getAudio?.(summary) ?? {
      pcm: new Int16Array(),
      sampleRate: 16000 as const,
      channels: 1 as const,
      durationMs: summary.durationMs
    }

    if (audio.pcm.length === 0) {
      this.setState('idle', EMPTY_CAPTURE_MESSAGE)
      return
    }

    await this.runPipeline(audio, summary)
  }

  handleCaptureFailed(message: unknown): void {
    if (this.state !== 'recording' && this.state !== 'transcribing') return
    this.enterError(typeof message === 'string' && message ? message : CAPTURE_FAILED_MESSAGE)
  }

  handleStopWatchdog(): void {
    if (this.state === 'transcribing' && !this.pipelineRunning) {
      this.enterError(STOP_MISSING_MESSAGE)
    }
  }

  private async runPipeline(audio: AudioInput, summary: RecordingSummary): Promise<void> {
    if (this.pipelineRunning) return
    this.pipelineRunning = true
    const startedAt = (this.deps.now ?? Date.now)()

    try {
      const options = { timeoutMs: this.deps.transcribeTimeoutMs }
      let result = await this.deps.provider.transcribe(audio, options)
      if (!result.ok && result.error.retryable && RETRYABLE_CODES.has(result.error.code)) {
        result = await this.deps.provider.transcribe(audio, options)
      }

      if (!result.ok) {
        this.enterError(result.error.message)
        return
      }

      const rawText = result.value.text
      const processed = this.deps.postprocess?.(rawText)
      // Defence in depth: a processor must never turn a real transcript into
      // nothing. The core stage already guards this, but the session owns the
      // paste contract and enforces it regardless of who supplies the stage.
      let text = rawText
      let applied: string[] = []
      if (processed && (processed.text.length > 0 || rawText.length === 0)) {
        text = processed.text
        applied = processed.applied
      }

      this.deps.sendTranscript({
        text,
        applied,
        fake: this.deps.fake,
        durationMs: summary.durationMs,
        latencyMs: (this.deps.now ?? Date.now)() - startedAt
      })

      this.setState('pasting')
      await this.deps.paste(text)
      this.setState('idle')
    } catch (error) {
      this.enterError(error instanceof Error ? error.message : String(error))
    } finally {
      this.pipelineRunning = false
    }
  }

  private setState(state: AppState, message?: string): void {
    this.state = state
    this.lastMessage = message
    this.deps.sendState(state, message)
  }

  private enterError(message: string): void {
    this.setState('error', message)
  }
}
