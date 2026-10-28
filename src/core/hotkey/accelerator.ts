/**
 * Pure Electron accelerator parsing. No Electron import: registration lives in
 * the `HotkeySource` adapter in main, so this can be unit-tested and reused by
 * the renderer for live validation.
 *
 * Syntax follows Electron's `Accelerator` strings: zero or more modifiers
 * followed by exactly one key. A binding without a modifier is rejected on
 * purpose — `globalShortcut` would otherwise swallow a bare key system-wide.
 */

export const DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+Space'

export type HotkeyModifier =
  | 'CommandOrControl'
  | 'Command'
  | 'Control'
  | 'Alt'
  | 'AltGr'
  | 'Shift'
  | 'Super'
  | 'Meta'

export type HotkeyKey = string

export interface ParsedAccelerator {
  /** Canonical Electron spelling, safe to hand to `globalShortcut.register`. */
  accelerator: string
  modifiers: readonly HotkeyModifier[]
  key: HotkeyKey
}

export type AcceleratorErrorCode =
  | 'NOT_STRING'
  | 'EMPTY'
  | 'NO_MODIFIER'
  | 'NO_KEY'
  | 'UNKNOWN_TOKEN'
  | 'MULTIPLE_KEYS'
  | 'DUPLICATE_MODIFIER'

export interface AcceleratorError {
  code: AcceleratorErrorCode
  token?: string
  message: string
}

export type ParseAcceleratorResult =
  | { ok: true; value: ParsedAccelerator }
  | { ok: false; error: AcceleratorError }

/**
 * Map, not an object literal: `MODIFIER_ALIASES[token]` would resolve inherited
 * properties (`constructor`, `__proto__`, …) and let them masquerade as
 * modifiers, silently producing a bare-key accelerator.
 */
const MODIFIER_ALIASES = new Map<string, HotkeyModifier>([
  ['command', 'Command'],
  ['cmd', 'Command'],
  ['control', 'Control'],
  ['ctrl', 'Control'],
  ['commandorcontrol', 'CommandOrControl'],
  ['cmdorctrl', 'CommandOrControl'],
  ['alt', 'Alt'],
  ['option', 'Alt'],
  ['altgr', 'AltGr'],
  ['shift', 'Shift'],
  ['super', 'Super'],
  ['meta', 'Meta']
])

/** Emission order for a canonical accelerator string. */
const MODIFIER_ORDER: readonly HotkeyModifier[] = [
  'CommandOrControl',
  'Command',
  'Control',
  'Alt',
  'AltGr',
  'Shift',
  'Super',
  'Meta'
]

/** Map for the same inherited-property reason as `MODIFIER_ALIASES`. */
const NAMED_KEYS = new Map<string, HotkeyKey>([
  ['space', 'Space'],
  ['tab', 'Tab'],
  ['capslock', 'Capslock'],
  ['numlock', 'Numlock'],
  ['scrolllock', 'Scrolllock'],
  ['backspace', 'Backspace'],
  ['delete', 'Delete'],
  ['insert', 'Insert'],
  ['return', 'Return'],
  ['enter', 'Return'],
  ['up', 'Up'],
  ['down', 'Down'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['home', 'Home'],
  ['end', 'End'],
  ['pageup', 'PageUp'],
  ['pagedown', 'PageDown'],
  ['escape', 'Escape'],
  ['esc', 'Escape'],
  ['volumeup', 'VolumeUp'],
  ['volumedown', 'VolumeDown'],
  ['volumemute', 'VolumeMute'],
  ['medianexttrack', 'MediaNextTrack'],
  ['mediaprevioustrack', 'MediaPreviousTrack'],
  ['mediastop', 'MediaStop'],
  ['mediaplaypause', 'MediaPlayPause'],
  ['printscreen', 'PrintScreen'],
  ['plus', 'Plus'],
  ['numdec', 'numdec'],
  ['numadd', 'numadd'],
  ['numsub', 'numsub'],
  ['nummult', 'nummult'],
  ['numdiv', 'numdiv']
])

const PUNCTUATION = new Set([
  ')',
  '!',
  '@',
  '#',
  '$',
  '%',
  '^',
  '&',
  '*',
  '(',
  ':',
  ';',
  '+',
  '-',
  '<',
  '=',
  '>',
  '?',
  ',',
  '_',
  '.',
  '/',
  '~',
  '`',
  '{',
  ']',
  '[',
  '|',
  '\\',
  '}',
  '"'
])

const LETTER = /^[a-z]$/i
const DIGIT = /^[0-9]$/
const FUNCTION_KEY = /^f([1-9]|1[0-9]|2[0-4])$/i
const NUM_PAD = /^num[0-9]$/

const NO_KEY_MESSAGE = '快捷键缺少要按下的主键。'
const NO_MODIFIER_MESSAGE =
  '快捷键必须包含至少一个修饰键（Command、Control、Alt 或 Shift）。'

function canonicalKey(token: string): HotkeyKey | undefined {
  const lower = token.toLowerCase()
  const named = NAMED_KEYS.get(lower)
  if (named) return named
  if (LETTER.test(token)) return token.toUpperCase()
  if (DIGIT.test(token)) return token
  if (FUNCTION_KEY.test(token)) return token.toUpperCase()
  if (NUM_PAD.test(lower)) return lower
  if (PUNCTUATION.has(token)) return token
  return undefined
}

/**
 * Independent invariant checks. These do not trust the alias/key tables: even
 * if a future table gained an inherited or malformed entry, a binding cannot
 * leave the parser without at least one real modifier and one real key.
 */
function isRealModifier(value: unknown): value is HotkeyModifier {
  return typeof value === 'string' && (MODIFIER_ORDER as readonly string[]).includes(value)
}

function isRealKey(value: unknown): value is HotkeyKey {
  return typeof value === 'string' && canonicalKey(value) === value
}

function fail(
  code: AcceleratorErrorCode,
  message: string,
  token?: string
): ParseAcceleratorResult {
  return { ok: false, error: token === undefined ? { code, message } : { code, token, message } }
}

function ok(value: ParsedAccelerator): ParseAcceleratorResult {
  return { ok: true, value }
}

export function parseAccelerator(value: unknown): ParseAcceleratorResult {
  if (typeof value !== 'string') {
    return fail('NOT_STRING', '快捷键必须是字符串。')
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return fail('EMPTY', '请输入快捷键，例如 CommandOrControl+Shift+Space。')
  }

  const seen = new Set<HotkeyModifier>()
  const modifiers: HotkeyModifier[] = []
  let key: HotkeyKey | undefined

  for (const raw of trimmed.split('+')) {
    const token = raw.trim()
    if (token.length === 0) {
      return fail('UNKNOWN_TOKEN', `无法识别「${token}」。`, token)
    }
    const modifier = MODIFIER_ALIASES.get(token.toLowerCase())
    if (modifier) {
      if (seen.has(modifier)) {
        return fail('DUPLICATE_MODIFIER', `修饰键「${token}」重复。`, token)
      }
      seen.add(modifier)
      modifiers.push(modifier)
      continue
    }
    const nextKey = canonicalKey(token)
    if (!nextKey) {
      return fail('UNKNOWN_TOKEN', `无法识别「${token}」。`, token)
    }
    if (key !== undefined) {
      return fail('MULTIPLE_KEYS', '快捷键只能包含一个主键。', token)
    }
    key = nextKey
  }

  if (key === undefined) {
    return fail('NO_KEY', NO_KEY_MESSAGE)
  }
  if (!isRealKey(key)) {
    return fail('NO_KEY', NO_KEY_MESSAGE)
  }

  const ordered = MODIFIER_ORDER.filter(
    (modifier) => seen.has(modifier) && isRealModifier(modifier)
  )
  if (ordered.length === 0) {
    return fail('NO_MODIFIER', NO_MODIFIER_MESSAGE, key)
  }

  return ok({
    accelerator: [...ordered, key].join('+'),
    modifiers: ordered,
    key
  })
}

/** Unknown or invalid stored values fall back to the documented default. */
export function parseHotkeyPreference(value: unknown): string {
  const parsed = parseAccelerator(value)
  return parsed.ok ? parsed.value.accelerator : DEFAULT_ACCELERATOR
}

const MODIFIER_DISPLAY: Record<HotkeyModifier, string> = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Control: '⌃',
  Alt: '⌥',
  AltGr: '⌥',
  Shift: '⇧',
  Super: '⌘',
  Meta: '⌘'
}

/** v0.1 ships on macOS, so key caps use the macOS glyphs. */
const KEY_DISPLAY: Record<string, string> = {
  Space: 'Space',
  Return: '↩',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn'
}

export function acceleratorDisplayParts(accelerator: string): string[] {
  const parsed = parseAccelerator(accelerator)
  if (!parsed.ok) return [accelerator]
  return [
    ...parsed.value.modifiers.map((modifier) => MODIFIER_DISPLAY[modifier] ?? modifier),
    KEY_DISPLAY[parsed.value.key] ?? parsed.value.key
  ]
}
