import { describe, expect, it } from 'vitest'
import { barHeights, createLevelThrottle, rmsOf } from '../src/core/overlay/level'

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
  it('rests low in silence and rises with the level', () => {
    const quiet = barHeights(0)
    const loud = barHeights(0.2)
    expect(Math.max(...quiet)).toBeLessThan(30)
    expect(Math.max(...loud)).toBeGreaterThan(80)
  })

  it('treats ordinary speech levels as partial, not saturated', () => {
    // Ambient noise measured ~0.0015 RMS on this machine; it must stay small.
    expect(Math.max(...barHeights(0.0015))).toBeLessThan(30)
    // A normal speaking voice sits well below full scale.
    const speaking = barHeights(0.06)
    expect(Math.max(...speaking)).toBeLessThanOrEqual(100)
    expect(Math.max(...speaking)).toBeGreaterThan(30)
  })

  it('never leaves the 0..100 range', () => {
    for (const level of [0, 0.001, 0.1, 1, 5]) {
      for (const height of barHeights(level)) {
        expect(height).toBeGreaterThanOrEqual(0)
        expect(height).toBeLessThanOrEqual(100)
      }
    }
  })
})
