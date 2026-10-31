import { describe, expect, it } from 'vitest'
import {
  PILL_BAR_REST_SCALE,
  PILL_BARS,
  barScales,
  createLevelThrottle,
  rmsOf
} from '../src/core/overlay/level'

describe('overlay level', () => {
  it('reports silence as zero and a full-scale square wave as one', () => {
    expect(rmsOf(new Int16Array(64))).toBe(0)
    const square = new Int16Array(64).fill(32767)
    expect(rmsOf(square)).toBeCloseTo(1, 2)
  })

  it('never emits more than 30 updates in any rolling second', () => {
    const throttle = createLevelThrottle()
    let sent = 0
    for (let ms = 0; ms < 5000; ms += 1) {
      if (throttle.shouldSend(ms)) sent += 1
    }
    // 5 seconds at <= 30/s
    expect(sent).toBeLessThanOrEqual(150)
    expect(sent).toBeGreaterThan(100)
  })

  it('spaces two accepted updates by at least the interval', () => {
    const throttle = createLevelThrottle()
    const accepted: number[] = []
    for (let ms = 0; ms < 500; ms += 1) if (throttle.shouldSend(ms)) accepted.push(ms)
    for (let i = 1; i < accepted.length; i += 1) {
      expect(accepted[i] - accepted[i - 1]).toBeGreaterThanOrEqual(34)
    }
  })
})

describe('waveform bars', () => {
  it('collapses every bar to the same resting scale in silence, giving a dashed line', () => {
    const scales = barScales(0, 0)
    expect(scales).toHaveLength(PILL_BARS)
    for (const scale of scales) expect(scale).toBeCloseTo(PILL_BAR_REST_SCALE, 5)
  })

  it('stays at rest for ambient noise and rises for speech', () => {
    const ambient = Math.max(...barScales(0.0015, 0))
    const speech = Math.max(...barScales(0.06, 0))
    expect(ambient).toBeCloseTo(PILL_BAR_REST_SCALE, 5)
    expect(speech).toBeGreaterThan(0.6)
  })

  it('grows with the level and never leaves 0..1', () => {
    let previous = 0
    for (const level of [0, 0.01, 0.05, 0.1, 0.3, 1, 5]) {
      const peak = Math.max(...barScales(level, 0))
      expect(peak).toBeGreaterThanOrEqual(previous)
      expect(peak).toBeGreaterThanOrEqual(PILL_BAR_REST_SCALE)
      expect(peak).toBeLessThanOrEqual(1)
      previous = peak
    }
  })

  it('shifts the pattern with the ripple phase so the bars move between updates', () => {
    const a = barScales(0.06, 0)
    const b = barScales(0.06, 1.3)
    expect(a).not.toEqual(b)
  })
})
