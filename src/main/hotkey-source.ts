import type {
  HotkeyBinding,
  HotkeyCapabilities,
  HotkeySource,
  HotkeyStartResult,
  Unsubscribe
} from '../core/hotkey/types'

/** The slice of Electron's `globalShortcut` this adapter needs; tests inject a double. */
export interface GlobalShortcutPort {
  register(accelerator: string, callback: () => void): boolean
  unregisterAll(): void
}

/**
 * ADR-0003 v0.1 hotkey adapter. `start` unregisters everything first so a
 * binding change cannot leave the previous accelerator live; the result names
 * which bindings the OS refused, which drives the default fallback.
 */
export class ElectronGlobalShortcutSource implements HotkeySource {
  readonly id = 'electron-global-shortcut'
  readonly capabilities: HotkeyCapabilities = {
    supportsFn: false,
    supportsRightModifier: false,
    canSuppress: false,
    requiresAccessibility: false,
    requiresInputMonitoring: false
  }

  private readonly pressListeners = new Set<(binding: HotkeyBinding) => void>()
  private readonly releaseListeners = new Set<(binding: HotkeyBinding) => void>()

  constructor(private readonly shortcut: GlobalShortcutPort) {}

  async start(bindings: HotkeyBinding[]): Promise<HotkeyStartResult> {
    this.shortcut.unregisterAll()
    const result: HotkeyStartResult = { registered: [], failed: [] }
    for (const binding of bindings) {
      const registered = this.shortcut.register(binding.accelerator, () => {
        for (const listener of this.pressListeners) listener(binding)
      })
      if (registered) result.registered.push(binding.accelerator)
      else result.failed.push(binding.accelerator)
    }
    return result
  }

  async stop(): Promise<void> {
    this.shortcut.unregisterAll()
  }

  onPress(listener: (binding: HotkeyBinding) => void): Unsubscribe {
    this.pressListeners.add(listener)
    return () => this.pressListeners.delete(listener)
  }

  /**
   * `globalShortcut` exposes no key-up event. The ADR keeps the method so a
   * native event tap can honour hold-to-talk later; this adapter never emits.
   */
  onRelease(listener: (binding: HotkeyBinding) => void): Unsubscribe {
    this.releaseListeners.add(listener)
    return () => this.releaseListeners.delete(listener)
  }
}
