import { describe, expect, it } from 'vitest'
import { PcmBatcher, PCM_BATCH_SAMPLES } from '../src/core/capture/pcm-batcher'

describe('PCM batcher', () => {
  it('accumulates worklet frames into 20 ms batches', () => {
    const batcher = new PcmBatcher()
    expect(batcher.push(new Float32Array(128), 100)).toHaveLength(0)
    expect(batcher.pendingSamples).toBe(128)
    expect(batcher.push(new Float32Array(128), 110)).toHaveLength(0)
    expect(batcher.pendingSamples).toBe(256)

    const batches = batcher.push(new Float32Array(128), 120)
    expect(batches).toHaveLength(1)
    expect(batches[0]?.samples).toHaveLength(PCM_BATCH_SAMPLES)
    expect(batches[0]?.sequence).toBe(0)
    expect(batches[0]?.capturedAtMs).toBe(100)
    expect(batcher.pendingSamples).toBe(64)
  })

  it('clamps Float32 samples into the Int16 range', () => {
    const batcher = new PcmBatcher(4)
    const [batch] = batcher.push(new Float32Array([2, -2, 0.5, -0.5]), 0)
    expect(Array.from(batch?.samples ?? [])).toEqual([32767, -32768, 16384, -16384])
  })

  it('flushes a final partial batch and increments the sequence', () => {
    const batcher = new PcmBatcher(4)
    const first = batcher.push(new Float32Array([0, 0, 0, 0]), 5)
    expect(first[0]?.sequence).toBe(0)
    const pending = batcher.push(new Float32Array([0, 0]), 9)
    expect(pending).toHaveLength(0)

    const final = batcher.flush()
    expect(final?.sequence).toBe(1)
    expect(final?.samples).toHaveLength(2)
    expect(final?.capturedAtMs).toBe(9)
    expect(batcher.flush()).toBeNull()
  })

  it('handles a frame larger than one batch', () => {
    const batcher = new PcmBatcher(4)
    const batches = batcher.push(new Float32Array(10), 0)
    expect(batches).toHaveLength(2)
    expect(batches.map((batch) => batch.samples.length)).toEqual([4, 4])
    expect(batcher.pendingSamples).toBe(2)
    expect(batches[1]?.sequence).toBe(1)
  })
})
