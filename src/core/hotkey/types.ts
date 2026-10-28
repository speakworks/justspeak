/**
 * ADR-0003 `HotkeySource` boundary. Platform-specific code (Electron's
 * `globalShortcut` today, a native event tap later) implements this; callers
 * only see bindings and press events, never the adapter.
 */

export interface HotkeyBinding {
  accelerator: string
}

export interface HotkeyCapabilities {
  supportsFn: boolean
  supportsRightModifier: boolean
  canSuppress: boolean
  requiresAccessibility: boolean
  requiresInputMonitoring: boolean
}

export interface HotkeyStartResult {
  registered: string[]
  failed: string[]
}

export type Unsubscribe = () => void

export interface HotkeySource {
  readonly id: string
  readonly capabilities: HotkeyCapabilities
  start(bindings: HotkeyBinding[]): Promise<HotkeyStartResult>
  stop(): Promise<void>
  onPress(listener: (binding: HotkeyBinding) => void): Unsubscribe
  onRelease(listener: (binding: HotkeyBinding) => void): Unsubscribe
}
