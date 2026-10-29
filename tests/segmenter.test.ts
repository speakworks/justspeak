import { describe, expect, it } from 'vitest'
import {
  MIN_SEGMENT_MS,
  SEGMENTED_MAX_SESSION_SAMPLES,
  segmentPcm
} from '../src/core/audio/segmenter'
import { samplesFor, signalPcm, type SignalPart } from './audio-signal'

const SPEECH = 0.1
const QUIET = 0.002
const NO_PAD = { padMs: 0 }

function segment(parts: SignalPart[], options: Record<string, number> = {}) {
  return segmentPcm(signalPcm(parts), { ...NO_PAD, ...options })
}

describe('segmenter edge cases', () => {
  it('returns no segments for all silence', () => {
    const result = segment([{ ms: 1200, amplitude: QUIET }])
    expect(result).toEqual({ ok: true, segments: [] })
  })

  it('returns one segment covering an unbroken utterance', () => {
    const pcm = signalPcm([{ ms: 1000, amplitude: SPEECH }])
    const result = segmentPcm(pcm, NO_PAD)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]).toMatchObject({
      index: 0,
      startSample: 0,
      endSample: pcm.length
    })
    expect(Array.from(result.segments[0].pcm)).toEqual(Array.from(pcm))
  })

  it('returns one segment for a one-word utterance', () => {
    const result = segment([
      { ms: 500, amplitude: QUIET },
      { ms: 300, amplitude: SPEECH },
      { ms: 500, amplitude: QUIET }
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]).toMatchObject({
      index: 0,
      startSample: samplesFor(500),
      endSample: samplesFor(800)
    })
  })

  it('trims silence at both ends of the session', () => {
    const result = segment([
      { ms: 800, amplitude: QUIET },
      { ms: 400, amplitude: SPEECH },
      { ms: 800, amplitude: QUIET }
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].startSample).toBe(samplesFor(800))
    expect(result.segments[0].endSample).toBe(samplesFor(1200))
    expect(result.segments[0].pcm).toHaveLength(samplesFor(400))
  })

  it('keeps utterance order and never loses speech samples', () => {
    const pcm = signalPcm([
      { ms: 500, amplitude: QUIET },
      { ms: 400, amplitude: 0.1 },
      { ms: 600, amplitude: QUIET },
      { ms: 300, amplitude: 0.2 },
      { ms: 700, amplitude: QUIET },
      { ms: 400, amplitude: 0.3 },
      { ms: 1000, amplitude: QUIET }
    ])
    const result = segmentPcm(pcm, NO_PAD)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.segments.map((entry) => entry.index)).toEqual([0, 1, 2])
    expect(result.segments.map((entry) => [entry.startSample, entry.endSample])).toEqual([
      [samplesFor(500), samplesFor(900)],
      [samplesFor(1500), samplesFor(1800)],
      [samplesFor(2500), samplesFor(2900)]
    ])
    for (const entry of result.segments) {
      expect(Array.from(entry.pcm)).toEqual(
        Array.from(pcm.slice(entry.startSample, entry.endSample))
      )
      expect(entry.pcm.length).toBeGreaterThan(0)
    }
  })
})

describe('minimum segment length', () => {
  it('merges two short utterances instead of dropping either', () => {
    const result = segment(
      [
        { ms: 260, amplitude: 0.1 },
        { ms: 500, amplitude: QUIET },
        { ms: 260, amplitude: 0.2 },
        { ms: 500, amplitude: QUIET }
      ],
      { minSegmentMs: 300 }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]).toMatchObject({
      startSample: 0,
      endSample: samplesFor(1020)
    })
  })

  it('widens a lone short region with surrounding silence', () => {
    const result = segment(
      [
        { ms: 1000, amplitude: QUIET },
        { ms: 260, amplitude: 0.1 },
        { ms: 1000, amplitude: QUIET }
      ],
      { minSegmentMs: 500 }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].pcm).toHaveLength(samplesFor(500))
    expect(result.segments[0].startSample).toBeLessThan(samplesFor(1000))
    expect(result.segments[0].endSample).toBeGreaterThan(samplesFor(1260))
  })

  it('keeps a default minimum above one analysis frame', () => {
    expect(MIN_SEGMENT_MS).toBeGreaterThan(20)
  })
})

describe('session bound and invalid input', () => {
  it('accepts exactly the 120 s session bound', () => {
    const result = segmentPcm(new Int16Array(SEGMENTED_MAX_SESSION_SAMPLES), NO_PAD)
    expect(result).toEqual({ ok: true, segments: [] })
  })

  it('rejects audio above the 120 s session bound instead of truncating', () => {
    const pcm = new Int16Array(SEGMENTED_MAX_SESSION_SAMPLES + 1)
    const result = segmentPcm(pcm, NO_PAD)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('AUDIO_TOO_LONG')
    expect(result.error.message).toContain(String(SEGMENTED_MAX_SESSION_SAMPLES + 1))
  })

  it('honours a caller-supplied bound', () => {
    const result = segmentPcm(new Int16Array(1001), { ...NO_PAD, maxSessionSamples: 1000 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('AUDIO_TOO_LONG')
  })

  it('rejects non-PCM input', () => {
    const result = segmentPcm(null as unknown as Int16Array)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('INVALID_AUDIO')
  })

  it('turns an invalid VAD configuration into a typed error', () => {
    const pcm = signalPcm([{ ms: 500, amplitude: SPEECH }])
    const invalidThresholds = segmentPcm(pcm, {
      ...NO_PAD,
      startThreshold: 0.001,
      endThreshold: 0.002
    })
    expect(invalidThresholds.ok).toBe(false)
    if (!invalidThresholds.ok) expect(invalidThresholds.error.code).toBe('INVALID_CONFIG')

    const invalidMinimum = segmentPcm(pcm, { ...NO_PAD, minSegmentMs: -1 })
    expect(invalidMinimum.ok).toBe(false)
    if (!invalidMinimum.ok) expect(invalidMinimum.error.code).toBe('INVALID_CONFIG')
  })
})
