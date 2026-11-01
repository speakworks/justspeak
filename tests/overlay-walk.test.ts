import { describe, expect, it } from 'vitest'
import { PILL_BARS } from '../src/core/overlay/level'
import {
  WALK_LAST_INDEX,
  WALK_STEP_MS,
  advanceWalk,
  completeWalk,
  walkPhase
} from '../src/core/overlay/walk'

describe('working-state walk', () => {
  it('uses the same bar count as the waveform', () => {
    expect(WALK_LAST_INDEX).toBe(PILL_BARS - 1)
    expect(WALK_STEP_MS).toBeGreaterThan(0)
  })

  it('marks bars before, at, and after the highlight', () => {
    expect(walkPhase(0, 3)).toBe('passed')
    expect(walkPhase(2, 3)).toBe('passed')
    expect(walkPhase(3, 3)).toBe('active')
    expect(walkPhase(4, 3)).toBe('pending')
  })

  it('advances one bar and clamps at the end', () => {
    expect(advanceWalk(0)).toBe(1)
    expect(advanceWalk(WALK_LAST_INDEX - 1)).toBe(WALK_LAST_INDEX)
    expect(advanceWalk(WALK_LAST_INDEX)).toBe(WALK_LAST_INDEX)
    expect(advanceWalk(-5)).toBe(0)
  })

  it('completes on the last bar', () => {
    expect(completeWalk()).toBe(WALK_LAST_INDEX)
  })
})
