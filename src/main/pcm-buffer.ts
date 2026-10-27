import type { PcmBatch } from '../shared/ipc'

export const PCM_SAMPLE_RATE = 16000
export const MAX_SESSION_SAMPLES = 120 * PCM_SAMPLE_RATE
export const MAX_BATCH_SAMPLES = 4800 // 300 ms at 16 kHz

export type PcmBufferErrorCode = 'INVALID_BATCH' | 'AUDIO_TOO_LONG' | 'NOT_RECORDING'

export interface PcmBufferError {
  code: PcmBufferErrorCode
  message: string
}

export interface PcmBufferStats {
  batches: number
  samples: number
  durationMs: number
  gaps: number
  droppedLate: number
  rejected: number
}

export type AppendResult = { ok: true } | { ok: false; error: PcmBufferError }

/**
 * Bounded session audio owned by the main process. Every IPC batch is
 * validated before it can grow the buffer (ADR-0003 / AUDIO-PIPELINE).
 */
export class PcmBuffer {
  private readonly maxSamples: number
  private readonly maxBatchSamples: number
  private chunks: Int16Array[] = []
  private samples = 0
  private batches = 0
  private gaps = 0
  private droppedLate = 0
  private rejected = 0
  private lastSequence = -1
  private active = false

  constructor(maxSamples = MAX_SESSION_SAMPLES, maxBatchSamples = MAX_BATCH_SAMPLES) {
    this.maxSamples = maxSamples
    this.maxBatchSamples = maxBatchSamples
  }

  begin(): void {
    this.chunks = []
    this.samples = 0
    this.batches = 0
    this.gaps = 0
    this.droppedLate = 0
    this.rejected = 0
    this.lastSequence = -1
    this.active = true
  }

  get isActive(): boolean {
    return this.active
  }

  append(value: unknown): AppendResult {
    if (!this.active) {
      this.droppedLate += 1
      return {
        ok: false,
        error: { code: 'NOT_RECORDING', message: 'Session is not recording' }
      }
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      !(value instanceof Object) ||
      !('samples' in value) ||
      !((value as PcmBatch).samples instanceof Int16Array)
    ) {
      this.rejected += 1
      return {
        ok: false,
        error: { code: 'INVALID_BATCH', message: 'PCM batch is invalid' }
      }
    }

    const batch = value as PcmBatch
    const sequence = batch.sequence
    const capturedAtMs = batch.capturedAtMs
    const samples = batch.samples
    if (
      !Number.isInteger(sequence) ||
      sequence < 0 ||
      typeof capturedAtMs !== 'number' ||
      !Number.isFinite(capturedAtMs)
    ) {
      this.rejected += 1
      return {
        ok: false,
        error: { code: 'INVALID_BATCH', message: 'PCM batch metadata is invalid' }
      }
    }
    if (samples.length === 0) {
      this.rejected += 1
      return {
        ok: false,
        error: { code: 'INVALID_BATCH', message: 'PCM batch is empty' }
      }
    }
    if (samples.length > this.maxBatchSamples) {
      this.rejected += 1
      return {
        ok: false,
        error: {
          code: 'INVALID_BATCH',
          message: `PCM batch exceeds ${this.maxBatchSamples} samples`
        }
      }
    }
    if (this.lastSequence >= 0 && sequence <= this.lastSequence) {
      this.rejected += 1
      return {
        ok: false,
        error: { code: 'INVALID_BATCH', message: 'PCM batch is out of order' }
      }
    }
    if (this.samples + samples.length > this.maxSamples) {
      // No silent truncation: reject the batch and let the session surface it.
      return {
        ok: false,
        error: {
          code: 'AUDIO_TOO_LONG',
          message: `Audio exceeds ${Math.round(this.maxSamples / PCM_SAMPLE_RATE)} seconds`
        }
      }
    }

    if (this.lastSequence >= 0 && sequence > this.lastSequence + 1) {
      this.gaps += sequence - this.lastSequence - 1
    }
    this.lastSequence = sequence
    this.batches += 1
    this.samples += samples.length
    this.chunks.push(samples)
    return { ok: true }
  }

  finish(): { pcm: Int16Array; stats: PcmBufferStats } {
    const pcm = new Int16Array(this.samples)
    let offset = 0
    for (const chunk of this.chunks) {
      pcm.set(chunk, offset)
      offset += chunk.length
    }
    const stats: PcmBufferStats = {
      batches: this.batches,
      samples: this.samples,
      durationMs: Math.round((this.samples / PCM_SAMPLE_RATE) * 1000),
      gaps: this.gaps,
      droppedLate: this.droppedLate,
      rejected: this.rejected
    }
    this.chunks = []
    this.samples = 0
    this.active = false
    return { pcm, stats }
  }
}
