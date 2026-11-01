import { describe, expect, it } from 'vitest'
import { panelHint } from '../src/core/panel/hint'

describe('copy panel hint', () => {
  it('names Escape only when its global shortcut registered', () => {
    expect(panelHint(true)).toContain('Esc')
    expect(panelHint(false)).not.toContain('Esc')
    expect(panelHint(false)).toBe('文字未自动粘贴')
  })
})
