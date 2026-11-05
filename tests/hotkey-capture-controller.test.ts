import { describe, expect, it, vi } from 'vitest'
import {
  HotkeyCaptureController,
  type HotkeyCaptureDeps,
  type HotkeyCaptureTimer
} from '../src/core/hotkey/capture-controller'
import { DEFAULT_ACCELERATOR } from '../src/core/hotkey/accelerator'
import type {
  HotkeyBinding,
  HotkeyCapabilities,
  HotkeySource,
  HotkeyStartResult,
  Unsubscribe
} from '../src/core/hotkey/types'

const CAPABILITIES: HotkeyCapabilities = {
  supportsFn: false,
  supportsRightModifier: false,
  canSuppress: false,
  requiresAccessibility: false,
  requiresInputMonitoring: false
}

class FakeSource implements HotkeySource {
  readonly id = 'fake'
  readonly capabilities = CAPABILITIES
  stops = 0
  started: string[][] = []
  taken = new Set<string>()

  async start(bindings: HotkeyBinding[]): Promise<HotkeyStartResult> {
    this.started.push(bindings.map((binding) => binding.accelerator))
    const failed = bindings
      .filter((binding) => this.taken.has(binding.accelerator))
      .map((binding) => binding.accelerator)
    return {
      registered: bindings
        .filter((binding) => !this.taken.has(binding.accelerator))
        .map((binding) => binding.accelerator),
      failed
    }
  }

  async stop(): Promise<void> {
    this.stops += 1
  }

  onPress(_listener: (binding: HotkeyBinding) => void): Unsubscribe {
    return () => {}
  }

  onRelease(_listener: (binding: HotkeyBinding) => void): Unsubscribe {
    return () => {}
  }
}

class FakeTimer implements HotkeyCaptureTimer {
  private next = 1
  readonly callbacks = new Map<number, () => void>()
  readonly delays: number[] = []
  cleared: number[] = []

  set(callback: () => void, delayMs: number): unknown {
    const handle = this.next
    this.next += 1
    this.callbacks.set(handle, callback)
    this.delays.push(delayMs)
    return handle
  }

  clear(handle: unknown): void {
    const id = handle as number
    this.cleared.push(id)
    this.callbacks.delete(id)
  }

  fire(): void {
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    for (const callback of callbacks) callback()
  }
}

interface Harness {
  controller: HotkeyCaptureController
  source: FakeSource
  timer: FakeTimer
  menu: boolean[]
  active: { value: string }
  setActive: HotkeyCaptureDeps['setActive']
  registrationChanged: number
  registrationStates: boolean[]
  restored: unknown[]
}

function harness(overrides: Partial<HotkeyCaptureDeps> = {}): Harness {
  const source = new FakeSource()
  const timer = new FakeTimer()
  const menu: boolean[] = []
  const active = { value: DEFAULT_ACCELERATOR }
  const state: Harness = {
    controller: null as unknown as HotkeyCaptureController,
    source,
    timer,
    menu,
    active,
    setActive: (accelerator, message) => {
      active.value = accelerator
      if (message) state.restored.push(message)
    },
    registrationChanged: 0,
    registrationStates: [],
    restored: []
  }
  const controller = new HotkeyCaptureController({
    source,
    timer,
    timeoutMs: 15_000,
    getActive: () => active.value,
    setActive: state.setActive,
    onRegistrationChanged: (suspended) => {
      state.registrationChanged += 1
      state.registrationStates.push(suspended)
    },
    onRestored: (result) => state.restored.push(result),
    setMenuShortcutsIgnored: (ignored) => menu.push(ignored),
    ...overrides
  })
  state.controller = controller
  return state
}

describe('hotkey capture lifecycle', () => {
  it('unregisters the live key, suppresses menu shortcuts, and arms the timeout', async () => {
    const h = harness()
    expect(await h.controller.start()).toEqual({ ok: true })
    expect(h.source.stops).toBe(1)
    expect(h.menu).toEqual([true])
    expect(h.controller.isActive).toBe(true)
    expect(h.timer.delays).toEqual([15_000])
    expect(h.timer.callbacks.size).toBe(1)
    expect(h.registrationChanged).toBe(1)
    expect(h.registrationStates).toEqual([true])
  })

  it('refreshes the safety window on a repeated start', async () => {
    const h = harness()
    await h.controller.start()
    const firstHandle = [...h.timer.callbacks.keys()][0]
    await h.controller.start()
    expect(h.source.stops).toBe(1)
    expect(h.timer.cleared).toContain(firstHandle)
    expect(h.timer.callbacks.size).toBe(1)
    expect(h.timer.delays).toEqual([15_000, 15_000])
  })

  it('restores the previous accelerator on cancel', async () => {
    const h = harness()
    await h.controller.start()
    const result = await h.controller.cancel()
    expect(result).toEqual({ ok: true, accelerator: DEFAULT_ACCELERATOR })
    expect(h.source.started).toEqual([[DEFAULT_ACCELERATOR]])
    expect(h.active.value).toBe(DEFAULT_ACCELERATOR)
    expect(h.menu).toEqual([true, false])
    expect(h.controller.isActive).toBe(false)
    expect(h.timer.callbacks.size).toBe(0)
    expect(h.registrationChanged).toBe(2)
    expect(h.registrationStates).toEqual([true, false])
  })

  it('releases the capture for an apply without restoring the old key', async () => {
    const h = harness()
    await h.controller.start()
    h.controller.releaseForApply()
    expect(h.controller.isActive).toBe(false)
    expect(h.menu).toEqual([true, false])
    expect(h.timer.callbacks.size).toBe(0)
    const result = await h.controller.cancel()
    expect(result).toEqual({ ok: true, accelerator: DEFAULT_ACCELERATOR })
    expect(h.source.started).toEqual([])
  })

  it('restores and reports when the safety timer fires', async () => {
    const h = harness()
    await h.controller.start()
    h.timer.fire()
    await vi.waitFor(() => expect(h.restored).toHaveLength(1))
    expect(h.source.started).toEqual([[DEFAULT_ACCELERATOR]])
    expect(h.controller.isActive).toBe(false)
    expect(h.menu).toEqual([true, false])
    expect(h.restored[0]).toMatchObject({ ok: true, accelerator: DEFAULT_ACCELERATOR })
  })

  it('refuses to start without unregistering when stop throws', async () => {
    const h = harness()
    vi.spyOn(h.source, 'stop').mockRejectedValueOnce(new Error('unregister failed'))
    const result = await h.controller.start()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('unregister failed')
    expect(h.controller.isActive).toBe(false)
    expect(h.menu).toEqual([])
    expect(h.timer.delays).toEqual([])
  })

  it('does not invent a binding when none was live', async () => {
    const h = harness()
    h.active.value = ''
    await h.controller.start()
    const result = await h.controller.cancel()
    expect(result).toEqual({ ok: true, accelerator: '' })
    expect(h.source.started).toEqual([])
  })

  it('reports the failure when the previous key is taken and there is no fallback', async () => {
    const h = harness()
    h.source.taken.add(DEFAULT_ACCELERATOR)
    await h.controller.start()
    const result = await h.controller.cancel()
    expect(result.ok).toBe(false)
    expect(result.accelerator).toBe('')
    expect(result.message).toContain(DEFAULT_ACCELERATOR)
    expect(h.active.value).toBe('')
  })

  it('does not overwrite the live binding or notice on a clean restore', async () => {
    const h = harness()
    const activeCalls: Array<[string, string | undefined]> = []
    const controller = new HotkeyCaptureController({
      source: h.source,
      timer: h.timer,
      timeoutMs: 15_000,
      getActive: () => h.active.value,
      setActive: (accelerator, message) => activeCalls.push([accelerator, message]),
      setMenuShortcutsIgnored: () => {}
    })
    await controller.start()
    await controller.cancel()
    expect(activeCalls).toEqual([])
  })

  it('dispose is safe when no capture is active', () => {
    const h = harness()
    expect(() => h.controller.dispose()).not.toThrow()
    expect(h.menu).toEqual([false])
    expect(h.source.started).toEqual([])
  })
})
