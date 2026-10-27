import type { PcmBatch } from '../../shared/ipc'

export const PCM_BATCH_SAMPLES = 320 // 20 ms at 16 kHz

function toInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value))
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff)
}

/**
 * Accumulate device samples into fixed 20 ms Int16 batches. The worklet sends
 * raw Float32 quanta; this pure batcher owns clamping, sequencing, timestamps,
 * and the final partial batch at stop.
 */
export class PcmBatcher {
  private readonly batchSamples: number
  private buffer: Int16Array
  private filled = 0
  private sequence = 0
  private batchStartedAtMs = 0
  private lastCapturedAtMs = 0

  constructor(batchSamples: number = PCM_BATCH_SAMPLES) {
    this.batchSamples = batchSamples
    this.buffer = new Int16Array(batchSamples)
  }

  push(samples: Float32Array, capturedAtMs: number): PcmBatch[] {
    const batches: PcmBatch[] = []
    for (let i = 0; i < samples.length; i += 1) {
      if (this.filled === 0) this.batchStartedAtMs = capturedAtMs
      this.buffer[this.filled] = toInt16(samples[i])
      this.filled += 1
      if (this.filled === this.batchSamples) {
        batches.push(this.emit())
      }
    }
    this.lastCapturedAtMs = capturedAtMs
    return batches
  }

  flush(): PcmBatch | null {
    if (this.filled === 0) return null
    return this.emit()
  }

  get pendingSamples(): number {
    return this.filled
  }

  private emit(): PcmBatch {
    const samples = this.buffer.slice(0, this.filled)
    const batch: PcmBatch = {
      sequence: this.sequence,
      capturedAtMs: Math.round(this.batchStartedAtMs),
      samples
    }
    this.sequence += 1
    this.filled = 0
    this.buffer = new Int16Array(this.batchSamples)
    return batch
  }
}
