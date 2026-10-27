import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { encodeWav, readWavInfo, WAV_HEADER_BYTES } from '../src/core/asr/wav'

describe('WAV encoding', () => {
  it('writes a canonical 16 kHz mono PCM16 header', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768])
    const bytes = encodeWav(pcm)
    const view = new DataView(bytes.buffer)

    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + pcm.length * 2)
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WAVE')
    expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint32(28, true)).toBe(32000)
    expect(view.getUint16(32, true)).toBe(2)
    expect(view.getUint16(34, true)).toBe(16)
    expect(String.fromCharCode(...bytes.subarray(36, 40))).toBe('data')
    expect(view.getUint32(40, true)).toBe(pcm.length * 2)
    expect(bytes.byteLength).toBe(WAV_HEADER_BYTES + pcm.length * 2)
    expect(view.getInt16(WAV_HEADER_BYTES, true)).toBe(0)
    expect(view.getInt16(WAV_HEADER_BYTES + 2, true)).toBe(1)
    expect(view.getInt16(WAV_HEADER_BYTES + 4, true)).toBe(-1)
  })

  it('round-trips metadata through the reader', () => {
    const bytes = encodeWav(new Int16Array(16000))
    const info = readWavInfo(bytes)
    expect(info.sampleRate).toBe(16000)
    expect(info.channels).toBe(1)
    expect(info.bitsPerSample).toBe(16)
    expect(info.dataBytes).toBe(32000)
    expect(info.durationMs).toBe(1000)
  })

  it('rejects non-WAV input', () => {
    expect(() => readWavInfo(new Uint8Array(44))).toThrow(/RIFF/)
  })

  it('locates the data chunk after an extra FLLR chunk (afconvert fixture)', () => {
    const fixture = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
        'bench/fixtures/zh-4s.wav'
      )
    )
    const info = readWavInfo(fixture)
    expect(info.dataOffset).toBeGreaterThan(WAV_HEADER_BYTES)
    expect(info.dataOffset).toBe(4096)
    expect(info.sampleRate).toBe(16000)
    expect(info.channels).toBe(1)
    expect(info.bitsPerSample).toBe(16)
    expect(info.durationMs).toBeGreaterThan(3000)
    expect(info.durationMs).toBeLessThan(5000)
  })
})
