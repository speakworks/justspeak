import { describe, expect, it } from 'vitest'
import { parseAccelerator } from '../src/core/hotkey/accelerator'
import {
  captureHotkey,
  RESERVED_ACCELERATORS,
  type HotkeyKeyInput
} from '../src/core/hotkey/capture'

function key(
  code: string,
  modifiers: Partial<Pick<HotkeyKeyInput, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>> = {},
  value = ''
): HotkeyKeyInput {
  return {
    key: value,
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers
  }
}

describe('press-to-record hotkey capture', () => {
  const captured: Array<[label: string, input: HotkeyKeyInput, accelerator: string]> = [
    ['Command+Shift+Space', key('Space', { metaKey: true, shiftKey: true }), 'Command+Shift+Space'],
    ['Control+Alt+K', key('KeyK', { ctrlKey: true, altKey: true }), 'Control+Alt+K'],
    ['Command+1', key('Digit1', { metaKey: true }), 'Command+1'],
    ['Command+F12', key('F12', { metaKey: true }), 'Command+F12'],
    ['Command+Up', key('ArrowUp', { metaKey: true }), 'Command+Up'],
    ['Command+num5', key('Numpad5', { metaKey: true }), 'Command+num5'],
    ['Command+/', key('Slash', { metaKey: true }), 'Command+/'],
    ["Command+'", key('Quote', { metaKey: true }), "Command+'"],
    ['Command+Shift+/', key('Slash', { metaKey: true, shiftKey: true }), 'Command+Shift+/'],
    ['modified Escape', key('Escape', { metaKey: true }), 'Command+Escape'],
    ['Command+Backspace', key('Backspace', { metaKey: true }), 'Command+Backspace']
  ]

  it.each(captured)('captures %s', (_label, input, accelerator) => {
    expect(captureHotkey(input)).toEqual({ status: 'captured', accelerator })
  })

  it('reports held modifiers while the chord is unfinished', () => {
    expect(captureHotkey(key('MetaLeft', { metaKey: true }))).toEqual({
      status: 'pending',
      modifiers: ['Command']
    })
    expect(
      captureHotkey(key('ShiftRight', { metaKey: true, shiftKey: true }))
    ).toEqual({ status: 'pending', modifiers: ['Command', 'Shift'] })
  })

  it('cancels on bare Escape', () => {
    expect(captureHotkey(key('Escape'))).toEqual({ status: 'cancel' })
  })

  it('rejects a main key without a modifier', () => {
    const result = captureHotkey(key('KeyA'))
    expect(result.status).toBe('invalid')
    if (result.status === 'invalid') expect(result.message).toContain('至少一个修饰键')
  })

  it('rejects unsupported physical keys', () => {
    const result = captureHotkey(key('AudioVolumeUp', { metaKey: true }))
    expect(result.status).toBe('invalid')
    if (result.status === 'invalid') expect(result.message).toContain('不能用作快捷键')
  })

  it.each([
    ['Command+Q', key('KeyQ', { metaKey: true })],
    ['Command+W', key('KeyW', { metaKey: true })],
    ['Command+Shift+Q', key('KeyQ', { metaKey: true, shiftKey: true })],
    ['Command+Alt+Escape', key('Escape', { metaKey: true, altKey: true })],
    ['Command+Control+Q', key('KeyQ', { metaKey: true, ctrlKey: true })],
    ['Command+R', key('KeyR', { metaKey: true })],
    ['Command+C', key('KeyC', { metaKey: true })],
    ['Command+Space', key('Space', { metaKey: true })],
    ['Command+Shift+3', key('Digit3', { metaKey: true, shiftKey: true })],
    ['Command+-', key('Minus', { metaKey: true })],
    ['Command+`', key('Backquote', { metaKey: true })]
  ])('refuses the macOS-reserved %s', (_label, input) => {
    const result = captureHotkey(input)
    expect(result.status).toBe('invalid')
    if (result.status === 'invalid') expect(result.message).toContain('macOS 占用')
  })

  it('keeps every reserved accelerator parseable and canonical', () => {
    for (const accelerator of RESERVED_ACCELERATORS) {
      const parsed = parseAccelerator(accelerator)
      expect(parsed.ok, accelerator).toBe(true)
      if (parsed.ok) expect(parsed.value.accelerator).toBe(accelerator)
    }
  })

  it('never emits a modifier-less accelerator', () => {
    const keys = ['KeyA', 'Digit1', 'F1', 'Space', 'ArrowUp', 'Slash', 'Numpad0']
    for (const code of keys) {
      expect(captureHotkey(key(code)).status).toBe('invalid')
    }
  })

  it('never emits an accelerator the parser rejects', () => {
    // Every captured result is already canonical; a second pass must agree.
    const result = captureHotkey(key('KeyK', { ctrlKey: true, altKey: true, shiftKey: true }))
    expect(result).toEqual({ status: 'captured', accelerator: 'Control+Alt+Shift+K' })
  })
})
