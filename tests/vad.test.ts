import { describe, expect, it } from 'vitest'
import { detectSpeechRegions, resolveVadConfig } from '../src/core/audio/vad'
import { samplesFor, signalPcm, type SignalPart } from './audio-signal'

const SPEECH = 0.1
const DIP = 0.005 // below endThreshold, inside the hysteresis band
const NOISE = 0.002 // below endThreshold
const NO_PAD = { padMs: 0 }

function regions(parts: SignalPart[], overrides: Record<string, number> = NO_PAD) {
  return detectSpeechRegions(signalPcm(parts), overrides)
}

describe('RMS VAD with hysteresis', () => {
  it('returns no regions for all silence', () => {
    expect(regions([{ ms: 1000, amplitude: NOISE }])).toEqual([])
    expect(regions([{ ms: 1000, amplitude: 0 }])).toEqual([])
  })

  it('returns one region for an unbroken utterance', () => {
    const pcm = signalPcm([{ ms: 1000, amplitude: SPEECH }])
    expect(detectSpeechRegions(pcm, NO_PAD)).toEqual([
      { startSample: 0, endSample: pcm.length }
    ])
  })

  it('trims silence at both ends of the session', () => {
    expect(
      regions([
        { ms: 500, amplitude: NOISE },
        { ms: 500, amplitude: SPEECH },
        { ms: 500, amplitude: NOISE }
      ])
    ).toEqual([{ startSample: samplesFor(500), endSample: samplesFor(1000) }])
  })

  it('keeps a dip above endThreshold inside one region', () => {
    expect(
      regions([
        { ms: 400, amplitude: SPEECH },
        { ms: 200, amplitude: DIP },
        { ms: 400, amplitude: SPEECH },
        { ms: 500, amplitude: NOISE }
      ])
    ).toEqual([{ startSample: 0, endSample: samplesFor(1000) }])
  })

  it('splits once the quiet run reaches minSilenceMs', () => {
    expect(
      regions([
        { ms: 400, amplitude: SPEECH },
        { ms: 500, amplitude: NOISE },
        { ms: 400, amplitude: SPEECH }
      ])
    ).toEqual([
      { startSample: 0, endSample: samplesFor(400) },
      { startSample: samplesFor(900), endSample: samplesFor(1300) }
    ])
  })

  it('does not open a region below startThreshold even above endThreshold', () => {
    expect(regions([{ ms: 1000, amplitude: 0.012 }])).toEqual([])
    expect(regions([{ ms: 1000, amplitude: 0.01 }])).toEqual([])
  })

  it('keeps a fading tail while it stays above endThreshold', () => {
    expect(
      regions([
        { ms: 300, amplitude: SPEECH },
        { ms: 200, amplitude: 0.012 },
        { ms: 500, amplitude: NOISE }
      ])
    ).toEqual([{ startSample: 0, endSample: samplesFor(500) }])
  })

  it('discards a region shorter than minSpeechMs', () => {
    expect(
      regions([
        { ms: 500, amplitude: NOISE },
        { ms: 100, amplitude: SPEECH },
        { ms: 500, amplitude: NOISE }
      ])
    ).toEqual([])
  })

  it('pads a region by at most the configured amount', () => {
    expect(
      regions(
        [
          { ms: 1000, amplitude: NOISE },
          { ms: 400, amplitude: SPEECH },
          { ms: 1000, amplitude: NOISE }
        ],
        { padMs: 100 }
      )
    ).toEqual([
      { startSample: samplesFor(900), endSample: samplesFor(1500) }
    ])
  })

  it('never lets padding overlap two neighbouring regions', () => {
    const detected = regions(
      [
        { ms: 500, amplitude: NOISE },
        { ms: 400, amplitude: SPEECH },
        { ms: 500, amplitude: NOISE },
        { ms: 400, amplitude: SPEECH },
        { ms: 1000, amplitude: NOISE }
      ],
      { padMs: 400 }
    )
    expect(detected).toHaveLength(2)
    expect(detected[0].endSample).toBeLessThanOrEqual(detected[1].startSample)
  })

  it('returns nothing for empty audio', () => {
    expect(detectSpeechRegions(new Int16Array(0))).toEqual([])
  })
})

describe('VAD configuration', () => {
  it('rejects thresholds that destroy the hysteresis', () => {
    expect(() => resolveVadConfig({ endThreshold: 0.02 })).toThrow(/endThreshold/)
    expect(() => resolveVadConfig({ endThreshold: 0.03 })).toThrow(/endThreshold/)
    expect(() => resolveVadConfig({ startThreshold: 0 })).toThrow(/startThreshold/)
  })

  it('rejects unusable windows and durations', () => {
    expect(() => resolveVadConfig({ frameSamples: 0 })).toThrow(/frameSamples/)
    expect(() => resolveVadConfig({ frameSamples: 320.5 })).toThrow(/frameSamples/)
    expect(() => resolveVadConfig({ minSilenceMs: 0 })).toThrow(/minSilenceMs/)
    expect(() => resolveVadConfig({ padMs: -1 })).toThrow(/padMs/)
    expect(() => resolveVadConfig({ minSpeechMs: Number.NaN })).toThrow(/minSpeechMs/)
  })
})
