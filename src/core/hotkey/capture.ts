/**
 * Turn a keyboard event into an Electron accelerator.
 *
 * This is the pure half of the press-to-record control: the renderer owns the
 * DOM event, this module owns the layout mapping and the safety rules, and
 * `parseAccelerator` remains the single validator. Keeping it in `src/core`
 * means the capture rules are unit-tested without a browser or Electron.
 */

import {
  parseAccelerator,
  type HotkeyModifier
} from './accelerator'

export interface HotkeyKeyInput {
  /** `KeyboardEvent.key`; kept for callers/tests, the mapping uses `code`. */
  key: string
  /** `KeyboardEvent.code`, the layout-independent physical key. */
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export type HotkeyCaptureResult =
  /** Only modifiers are held; show them while the user finishes the chord. */
  | { status: 'pending'; modifiers: readonly HotkeyModifier[] }
  /** Escape without modifiers aborts the recording. */
  | { status: 'cancel' }
  | { status: 'invalid'; message: string }
  | { status: 'captured'; accelerator: string }

const MODIFIER_CODES = new Set([
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight'
])

/**
 * Map, not an object literal: a `code` such as `constructor` must never resolve
 * an inherited property and masquerade as a key.
 */
const NAMED_KEYS = new Map<string, string>([
  ['Space', 'Space'],
  ['Enter', 'Return'],
  ['NumpadEnter', 'Return'],
  ['Tab', 'Tab'],
  ['Backspace', 'Backspace'],
  ['Delete', 'Delete'],
  ['Insert', 'Insert'],
  ['ArrowUp', 'Up'],
  ['ArrowDown', 'Down'],
  ['ArrowLeft', 'Left'],
  ['ArrowRight', 'Right'],
  ['Home', 'Home'],
  ['End', 'End'],
  ['PageUp', 'PageUp'],
  ['PageDown', 'PageDown'],
  ['Escape', 'Escape'],
  ['CapsLock', 'Capslock'],
  ['NumLock', 'Numlock'],
  ['ScrollLock', 'Scrolllock'],
  ['PrintScreen', 'PrintScreen'],
  ['Numpad0', 'num0'],
  ['Numpad1', 'num1'],
  ['Numpad2', 'num2'],
  ['Numpad3', 'num3'],
  ['Numpad4', 'num4'],
  ['Numpad5', 'num5'],
  ['Numpad6', 'num6'],
  ['Numpad7', 'num7'],
  ['Numpad8', 'num8'],
  ['Numpad9', 'num9'],
  ['NumpadDecimal', 'numdec'],
  ['NumpadAdd', 'numadd'],
  ['NumpadSubtract', 'numsub'],
  ['NumpadMultiply', 'nummult'],
  ['NumpadDivide', 'numdiv'],
  ['Backquote', '`'],
  ['Minus', '-'],
  ['Equal', '='],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Backslash', '\\'],
  ['Semicolon', ';'],
  ['Quote', "'"],
  ['Comma', ','],
  ['Period', '.'],
  ['Slash', '/']
])

/**
 * macOS reserves these at the application or system level. Registering one as
 * a global dictation key would break the shortcut everywhere, so the recorder
 * refuses them instead of letting `globalShortcut` win the race.
 */
const RESERVED = new Set([
  // Application menu roles and edit/view shortcuts. Capturing suppresses the
  // native menu so these reach the recorder; they must not become global.
  'Command+Q',
  'Command+W',
  'Command+H',
  'Command+M',
  'Command+Tab',
  'Command+Shift+Q',
  'Command+Alt+Escape',
  'Command+Control+Q',
  'Command+Z',
  'Command+Shift+Z',
  'Command+X',
  'Command+C',
  'Command+V',
  'Command+A',
  'Command+R',
  'Command+Shift+R',
  'Command+0',
  'Command+Minus',
  'Command+Plus',
  'Command+=',
  'Command+Shift+=',
  'Command+Alt+I',
  'Command+Shift+I',
  'Command+Control+F',
  'Command+Backquote',
  // macOS system shortcuts (Spotlight, screenshots, emoji/Finder search). The
  // system may consume these before the app sees them; the list covers the
  // ones that do arrive.
  'Command+Space',
  'Command+Alt+Space',
  'Command+Control+Space',
  'Command+Shift+3',
  'Command+Shift+4',
  'Command+Shift+5',
  'Command+Shift+6'
])

const NO_MODIFIER_MESSAGE =
  '快捷键必须包含至少一个修饰键（Command、Control、Alt 或 Shift）。'
const UNSUPPORTED_MESSAGE = '这个键不能用作快捷键，请换一个组合。'
const RESERVED_MESSAGE = '这个组合被 macOS 占用，请换一个快捷键。'

const LETTER = /^Key[A-Z]$/
const DIGIT = /^Digit[0-9]$/
const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/

function keyFromCode(code: string): string | undefined {
  const named = NAMED_KEYS.get(code)
  if (named !== undefined) return named
  if (LETTER.test(code)) return code.slice(3)
  if (DIGIT.test(code)) return code.slice(5)
  if (FUNCTION_KEY.test(code)) return code
  return undefined
}

/** Canonical modifier order, matching `parseAccelerator`'s emission order. */
export function heldModifiers(
  input: Pick<HotkeyKeyInput, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>
): HotkeyModifier[] {
  const modifiers: HotkeyModifier[] = []
  if (input.metaKey) modifiers.push('Command')
  if (input.ctrlKey) modifiers.push('Control')
  if (input.altKey) modifiers.push('Alt')
  if (input.shiftKey) modifiers.push('Shift')
  return modifiers
}

export function captureHotkey(input: HotkeyKeyInput): HotkeyCaptureResult {
  const modifiers = heldModifiers(input)

  // A modifier alone is not a binding yet; the renderer shows it as a preview.
  if (MODIFIER_CODES.has(input.code)) {
    return { status: 'pending', modifiers }
  }

  // Bare Escape cancels. Modified Escape (e.g. Command+Escape) is a real key.
  if (input.code === 'Escape' && modifiers.length === 0) {
    return { status: 'cancel' }
  }

  const key = keyFromCode(input.code)
  if (key === undefined) {
    return { status: 'invalid', message: UNSUPPORTED_MESSAGE }
  }
  if (modifiers.length === 0) {
    return { status: 'invalid', message: NO_MODIFIER_MESSAGE }
  }

  // The same parser the typed input used stays the only validator; the capture
  // path cannot invent an accelerator the rest of the app would reject.
  const parsed = parseAccelerator([...modifiers, key].join('+'))
  if (!parsed.ok) {
    return { status: 'invalid', message: parsed.error.message }
  }
  if (RESERVED.has(parsed.value.accelerator)) {
    return { status: 'invalid', message: RESERVED_MESSAGE }
  }
  return { status: 'captured', accelerator: parsed.value.accelerator }
}
