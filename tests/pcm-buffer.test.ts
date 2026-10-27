import { describe, expect, it } from 'vitest'
import { MAX_BATCH_SAMPLES, PcmBuffer } from '../src/main/pcm-buffer'
import { PcmBatcher } from '../src/core/capture/pcm-batcher'

function batch(sequence: number, samples = 320): {
  sequence: number
  capturedAtMs: number
  samples: Int16Array
} {
  return { sequence, capturedAtMs: sequence * 20, samples: new Int16Array(samples).fill(1) }
}

describe('main PCM buffer', () => {
  it('appends valid batches and assembles them in order', () => {
    const buffer = new PcmBuffer()
    buffer.begin()
    expect(buffer.append(batch(0)).ok).toBe(true)
    expect(buffer.append(batch(1)).ok).toBe(true)
    const { pcm, stats } = buffer.finish()
    expect(pcm).toHaveLength(640)
    expect(pcm[0]).toBe(1)
    expect(pcm[639]).toBe(1)
    expect(stats.batches).toBe(2)
    expect(stats.samples).toBe(640)
    expect(stats.durationMs).toBe(40)
    expect(stats.gaps).toBe(0)
  })

  it('rejects an oversized batch without appending it', () => {
    const buffer = new PcmBuffer()
    buffer.begin()
    const result = buffer.append(batch(0, MAX_BATCH_SAMPLES + 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_BATCH')
    expect(buffer.finish().pcm).toHaveLength(0)
  })

  it('counts sequence gaps and rejects out-of-order batches', () => {
    const buffer = new PcmBuffer()
    buffer.begin()
    buffer.append(batch(0))
    buffer.append(batch(2))
    const outOfOrder = buffer.append(batch(2))
    expect(outOfOrder.ok).toBe(false)
    const { stats } = buffer.finish()
    expect(stats.gaps).toBe(1)
    expect(stats.rejected).toBe(1)
    expect(stats.batches).toBe(2)
  })

  it('returns AUDIO_TOO_LONG without truncating the buffer', () => {
    const buffer = new PcmBuffer(320, 320)
    buffer.begin()
    expect(buffer.append(batch(0)).ok).toBe(true)
    const result = buffer.append(batch(1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('AUDIO_TOO_LONG')
    const { pcm } = buffer.finish()
    expect(pcm).toHaveLength(320)
  })

  it('drops late batches after finish', () => {
    const buffer = new PcmBuffer()
    buffer.begin()
    buffer.append(batch(0))
    buffer.finish()
    const result = buffer.append(batch(1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_RECORDING')
    expect(buffer.isActive).toBe(false)
  })

  it('rejects malformed payloads', () => {
    const buffer = new PcmBuffer()
    buffer.begin()
    expect(buffer.append(null).ok).toBe(false)
    expect(buffer.append({ sequence: 0, capturedAtMs: 0, samples: [1, 2] }).ok).toBe(false)
    expect(buffer.append({ sequence: -1, capturedAtMs: 0, samples: new Int16Array(2) }).ok).toBe(
      false
    )
    expect(buffer.append({ sequence: 0, capturedAtMs: 0, samples: new Int16Array(0) }).ok).toBe(
      false
    )
    expect(buffer.finish().stats.rejected).toBe(4)
  })

  it('finishes an empty session with zero samples', () => {
    const buffer = new PcmBuffer()
    buffer.begin()
    const { pcm, stats } = buffer.finish()
    expect(pcm).toHaveLength(0)
    expect(stats.samples).toBe(0)
  })

  it('accepts the output of the renderer batcher', () => {
    const batcher = new PcmBatcher()
    const buffer = new PcmBuffer()
    buffer.begin()
    const batches = batcher.push(new Float32Array(640).fill(0.25), 0)
    const final = batcher.flush()
    for (const item of [...batches, ...(final ? [final] : [])]) {
      expect(buffer.append(item).ok).toBe(true)
    }
    const { pcm } = buffer.finish()
    expect(pcm).toHaveLength(640)
    expect(pcm[0]).toBe(8192)
  })
})
