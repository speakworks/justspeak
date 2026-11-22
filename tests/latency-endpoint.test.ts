import { describe, expect, it } from 'vitest'
import { DEFAULT_VAD_CONFIG } from '../src/core/audio/vad'
import { measureEndpoint } from '../scripts/latency-harness/endpoint'

const RATE = DEFAULT_VAD_CONFIG.sampleRate

function tone(ms: number, amplitude: number): Int16Array {
  const samples = Math.round((ms * RATE) / 1000)
  const out = new Int16Array(samples)
  for (let index = 0; index < samples; index += 1) {
    const value = Math.sin((2 * Math.PI * 440 * index) / RATE) * amplitude
    out[index] = Math.round(value * 0x8000)
  }
  return out
}

function silence(ms: number): Int16Array {
  return new Int16Array(Math.round((ms * RATE) / 1000))
}

function concat(...parts: Int16Array[]): Int16Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Int16Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

describe('measureEndpoint', () => {
  it('measures the structural delay: 400 ms silence after the last loud frame', () => {
    const outcome = measureEndpoint(concat(silence(1_000), tone(800, 0.5), silence(600)))
    if (outcome.status !== 'measured') throw new Error(outcome.reason)
    expect(outcome.lastSpeechFrameMs).toBe(1_800)
    expect(outcome.confirmedMs).toBe(2_200)
    expect(outcome.endpointMs).toBe(400)
    expect(outcome.silenceMs).toBe(400)
    expect(outcome.regions).toBe(1)
  })

  it('counts the hysteresis tail as part of the delay', () => {
    const outcome = measureEndpoint(concat(silence(1_000), tone(800, 0.5), tone(500, 0.02), silence(700)))
    if (outcome.status !== 'measured') throw new Error(outcome.reason)
    expect(outcome.lastSpeechFrameMs).toBe(1_800)
    expect(outcome.hysteresisMs).toBe(500)
    expect(outcome.endpointMs).toBe(900)
  })

  it('uses the last confirmed region when the clip holds two utterances', () => {
    const outcome = measureEndpoint(
      concat(silence(500), tone(500, 0.5), silence(500), tone(700, 0.5), silence(600))
    )
    if (outcome.status !== 'measured') throw new Error(outcome.reason)
    expect(outcome.regions).toBe(2)
    expect(outcome.endpointMs).toBe(400)
  })

  it('refuses to report a clip that ends while speech is still running', () => {
    const outcome = measureEndpoint(concat(silence(500), tone(1_000, 0.5)))
    expect(outcome.status).toBe('blocked')
    if (outcome.status !== 'blocked') throw new Error('expected blocked')
    expect(outcome.reason).toContain('以语音结尾')
  })

  it('refuses a clip with no speech at all', () => {
    const outcome = measureEndpoint(silence(2_000))
    expect(outcome.status).toBe('blocked')
    if (outcome.status !== 'blocked') throw new Error('expected blocked')
    expect(outcome.reason).toContain('未检测到')
  })

  it('refuses a blip shorter than the minimum speech window', () => {
    const outcome = measureEndpoint(concat(silence(500), tone(100, 0.5), silence(800)))
    expect(outcome.status).toBe('blocked')
  })

  it('refuses empty audio', () => {
    const outcome = measureEndpoint(new Int16Array(0))
    expect(outcome.status).toBe('blocked')
  })

  it('honours an overridden silence window', () => {
    const outcome = measureEndpoint(concat(silence(500), tone(500, 0.5), silence(400)), {
      minSilenceMs: 200
    })
    if (outcome.status !== 'measured') throw new Error(outcome.reason)
    expect(outcome.endpointMs).toBe(200)
  })
})
