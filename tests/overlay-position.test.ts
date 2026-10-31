import { describe, expect, it } from 'vitest'
import { INDICATOR_HEIGHT, INDICATOR_WIDTH, indicatorBounds } from '../src/core/overlay/position'

describe('indicator placement', () => {
  it('centres horizontally and clears the Dock by 15 pt', () => {
    const bounds = indicatorBounds({ x: 0, y: 25, width: 1512, height: 945 })
    expect(bounds.width).toBe(INDICATOR_WIDTH)
    expect(bounds.height).toBe(INDICATOR_HEIGHT)
    expect(bounds.x).toBe(Math.round((1512 - INDICATOR_WIDTH) / 2))
    expect(bounds.y).toBe(25 + 945 - INDICATOR_HEIGHT - 15)
  })

  it('follows a second display with a different work area', () => {
    const bounds = indicatorBounds({ x: 1512, y: 0, width: 1920, height: 1055 })
    expect(bounds.x).toBe(1512 + Math.round((1920 - INDICATOR_WIDTH) / 2))
    expect(bounds.y).toBe(0 + 1055 - INDICATOR_HEIGHT - 15)
  })

  it('never puts the pill above the work area on a short display', () => {
    const bounds = indicatorBounds({ x: 0, y: 0, width: 800, height: 90 })
    expect(bounds.y).toBeGreaterThanOrEqual(0)
  })
})
