import { describe, expect, it } from 'vitest'
import {
  acceleratorDisplayParts,
  DEFAULT_ACCELERATOR,
  parseAccelerator,
  parseHotkeyPreference
} from '../src/core/hotkey/accelerator'
import { registerHotkeyWithFallback } from '../src/core/hotkey/registration'
import type {
  HotkeyBinding,
  HotkeyCapabilities,
  HotkeySource,
  HotkeyStartResult,
  Unsubscribe
} from '../src/core/hotkey/types'
import {
  ElectronGlobalShortcutSource,
  type GlobalShortcutPort
} from '../src/main/hotkey-source'

const CAPABILITIES: HotkeyCapabilities = {
  supportsFn: false,
  supportsRightModifier: false,
  canSuppress: false,
  requiresAccessibility: false,
  requiresInputMonitoring: false
}

class FakeHotkeySource implements HotkeySource {
  readonly id = 'fake'
  readonly capabilities = CAPABILITIES
  readonly attempts: string[] = []
  private readonly taken: Set<string>
  private readonly pressListeners = new Set<(binding: HotkeyBinding) => void>()

  constructor(taken: string[]) {
    this.taken = new Set(taken)
  }

  async start(bindings: HotkeyBinding[]): Promise<HotkeyStartResult> {
    this.attempts.push(...bindings.map((binding) => binding.accelerator))
    const failed = bindings
      .filter((binding) => this.taken.has(binding.accelerator))
      .map((binding) => binding.accelerator)
    const registered = bindings
      .filter((binding) => !this.taken.has(binding.accelerator))
      .map((binding) => binding.accelerator)
    return { registered, failed }
  }

  async stop(): Promise<void> {}

  onPress(listener: (binding: HotkeyBinding) => void): Unsubscribe {
    this.pressListeners.add(listener)
    return () => this.pressListeners.delete(listener)
  }

  onRelease(_listener: (binding: HotkeyBinding) => void): Unsubscribe {
    return () => {}
  }

  press(accelerator: string): void {
    for (const listener of this.pressListeners) listener({ accelerator })
  }
}

describe('accelerator parser', () => {
  const accepted: Array<[input: string, canonical: string]> = [
    ['CommandOrControl+Shift+Space', 'CommandOrControl+Shift+Space'],
    ['cmdorctrl+shift+space', 'CommandOrControl+Shift+Space'],
    ['Cmd+Alt+Space', 'Command+Alt+Space'],
    ['Ctrl+K', 'Control+K'],
    ['control+shift+f12', 'Control+Shift+F12'],
    ['Alt+Enter', 'Alt+Return'],
    ['Option+Escape', 'Alt+Escape'],
    ['Shift+Plus', 'Shift+Plus'],
    ['Super+num5', 'Super+num5'],
    ['Meta+/', 'Meta+/']
  ]

  it.each(accepted)('accepts %s and canonicalizes it', (input, canonical) => {
    const parsed = parseAccelerator(input)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.accelerator).toBe(canonical)
  })

  const rejected: Array<[input: unknown, code: string]> = [
    [undefined, 'NOT_STRING'],
    [42, 'NOT_STRING'],
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['Space', 'NO_MODIFIER'],
    ['A', 'NO_MODIFIER'],
    ['Shift', 'NO_KEY'],
    ['CommandOrControl', 'NO_KEY'],
    ['Shift+', 'UNKNOWN_TOKEN'],
    ['CommandOrControl+NotAKey', 'UNKNOWN_TOKEN'],
    ['A+B', 'MULTIPLE_KEYS'],
    ['Shift+Shift+Space', 'DUPLICATE_MODIFIER']
  ]

  it.each(rejected)('rejects %j with %s', (input, code) => {
    const parsed = parseAccelerator(input)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error.code).toBe(code)
      expect(parsed.error.message.length).toBeGreaterThan(0)
    }
  })

  // Regression for the prototype-chain bypass: object-literal lookup tables
  // resolved inherited properties such as `constructor` and `__proto__`, so
  // `constructor+Space` parsed as a modified binding and produced bare `Space`.
  const prototypeTokens: Array<[input: string, code: string]> = [
    ['constructor+Space', 'UNKNOWN_TOKEN'],
    ['__proto__+Space', 'UNKNOWN_TOKEN'],
    ['Space+constructor', 'UNKNOWN_TOKEN'],
    ['hasOwnProperty+Space', 'UNKNOWN_TOKEN'],
    ['toString+Space', 'UNKNOWN_TOKEN'],
    ['valueOf+A', 'UNKNOWN_TOKEN'],
    ['constructor', 'UNKNOWN_TOKEN']
  ]

  it.each(prototypeTokens)('rejects prototype-named token %s', (input, code) => {
    const parsed = parseAccelerator(input)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error.code).toBe(code)
  })

  it('can never produce a bare accelerator from prototype-named tokens', () => {
    const produced = prototypeTokens.map(([input]) => {
      const parsed = parseAccelerator(input)
      return parsed.ok ? parsed.value.accelerator : undefined
    })
    // Direct invariant, not just an error-code check: a bare `Space` must be
    // impossible, because it would register a system-wide unmodified key.
    expect(produced).not.toContain('Space')
    expect(produced.every((value) => value === undefined)).toBe(true)
  })

  it('still accepts legitimately modified Space bindings', () => {
    expect(parseAccelerator('CommandOrControl+Space')).toMatchObject({
      ok: true,
      value: { accelerator: 'CommandOrControl+Space', modifiers: ['CommandOrControl'], key: 'Space' }
    })
    expect(parseAccelerator('Shift+Space')).toMatchObject({
      ok: true,
      value: { accelerator: 'Shift+Space', modifiers: ['Shift'], key: 'Space' }
    })
  })

  it('keeps the documented default valid', () => {
    const parsed = parseAccelerator(DEFAULT_ACCELERATOR)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.accelerator).toBe(DEFAULT_ACCELERATOR)
  })

  it('parses stored preferences, falling back for missing or invalid values', () => {
    expect(parseHotkeyPreference('cmd+shift+k')).toBe('Command+Shift+K')
    expect(parseHotkeyPreference('Space')).toBe(DEFAULT_ACCELERATOR)
    expect(parseHotkeyPreference(undefined)).toBe(DEFAULT_ACCELERATOR)
    expect(parseHotkeyPreference({})).toBe(DEFAULT_ACCELERATOR)
  })

  it('renders macOS key caps for the default binding', () => {
    expect(acceleratorDisplayParts(DEFAULT_ACCELERATOR)).toEqual(['⌘', '⇧', 'Space'])
    expect(acceleratorDisplayParts('Alt+Enter')).toEqual(['⌥', '↩'])
  })
})

describe('hotkey registration with fallback', () => {
  it('registers the requested binding when the OS accepts it', async () => {
    const source = new FakeHotkeySource([])
    const outcome = await registerHotkeyWithFallback(source, 'Command+Shift+K')
    expect(outcome).toEqual({ accelerator: 'Command+Shift+K', ok: true, fallbackUsed: false })
    expect(source.attempts).toEqual(['Command+Shift+K'])
  })

  it('falls back to the default and names the failed binding when it is taken', async () => {
    const source = new FakeHotkeySource(['Command+Shift+K'])
    const outcome = await registerHotkeyWithFallback(source, 'Command+Shift+K')
    expect(outcome.accelerator).toBe(DEFAULT_ACCELERATOR)
    expect(outcome.ok).toBe(false)
    expect(outcome.fallbackUsed).toBe(true)
    expect(outcome.message).toContain('Command+Shift+K')
    expect(source.attempts).toEqual(['Command+Shift+K', DEFAULT_ACCELERATOR])
  })

  it('reports both bindings when the default is taken too', async () => {
    const source = new FakeHotkeySource(['Command+Shift+K', DEFAULT_ACCELERATOR])
    const outcome = await registerHotkeyWithFallback(source, 'Command+Shift+K')
    expect(outcome.accelerator).toBe('')
    expect(outcome.ok).toBe(false)
    expect(outcome.message).toContain('Command+Shift+K')
    expect(outcome.message).toContain(DEFAULT_ACCELERATOR)
  })

  it('does not retry the same accelerator twice', async () => {
    const source = new FakeHotkeySource([DEFAULT_ACCELERATOR])
    const outcome = await registerHotkeyWithFallback(source, DEFAULT_ACCELERATOR)
    expect(outcome.accelerator).toBe('')
    expect(outcome.message).toContain(DEFAULT_ACCELERATOR)
    expect(source.attempts).toEqual([DEFAULT_ACCELERATOR])
  })

  it('works through the Electron adapter with an injected shortcut double', async () => {
    const registered: string[] = []
    let press: (() => void) | undefined
    const unregistered: number[] = []
    const shortcut: GlobalShortcutPort = {
      register(accelerator, callback) {
        registered.push(accelerator)
        if (accelerator === 'Command+Shift+K') return false
        press = callback
        return true
      },
      unregisterAll() {
        unregistered.push(1)
      }
    }
    const source = new ElectronGlobalShortcutSource(shortcut)
    const pressed: string[] = []
    source.onPress((binding) => pressed.push(binding.accelerator))

    const outcome = await registerHotkeyWithFallback(source, 'Command+Shift+K')
    expect(outcome.accelerator).toBe(DEFAULT_ACCELERATOR)
    expect(outcome.fallbackUsed).toBe(true)
    expect(outcome.message).toContain('Command+Shift+K')
    expect(registered).toEqual(['Command+Shift+K', DEFAULT_ACCELERATOR])
    expect(unregistered.length).toBe(2)

    press?.()
    expect(pressed).toEqual([DEFAULT_ACCELERATOR])
  })
})
