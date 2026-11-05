/**
 * The press-to-record lifecycle, independent of Electron.
 *
 * A recorder has to unregister the live accelerator before the renderer can
 * receive the chord, then put it back when the user cancels or abandons the
 * recording. Keeping that state machine here — with an injected `HotkeySource`
 * and clock — makes the safety behavior testable without spawning Electron.
 */

import { registerHotkeyWithFallback } from './registration'
import type { HotkeySource } from './types'
import type { HotkeyCaptureEndResult, HotkeyCaptureStartResult } from '../../shared/ipc'

export interface HotkeyCaptureTimer {
  /** Returns a handle passed back to `clear`. */
  set(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

export interface HotkeyCaptureDeps {
  source: HotkeySource
  timer: HotkeyCaptureTimer
  /** How long an armed recorder may keep the dictation key unregistered. */
  timeoutMs: number
  /** The accelerator that was live before the recording started. */
  getActive: () => string
  /** Record the accelerator that registration actually accepted. */
  setActive: (accelerator: string, message?: string) => void
  /**
   * Registration changed. `true` means the source just called `unregisterAll`
   * (capture start); `false` means a binding was registered again. The copy
   * panel must drop its hint on `true` without re-registering Escape, because
   * that Escape is how the user cancels the capture.
   */
  onRegistrationChanged?: (suspended: boolean) => void
  /** Main ends an abandoned recording and should notify the renderer. */
  onRestored?: (result: HotkeyCaptureEndResult) => void
  /** Native menu accelerators must not win while the recorder owns the keyboard. */
  setMenuShortcutsIgnored?: (ignored: boolean) => void
}

export class HotkeyCaptureController {
  private active = false
  private timerHandle: unknown

  constructor(private readonly deps: HotkeyCaptureDeps) {}

  get isActive(): boolean {
    return this.active
  }

  /**
   * Unregister the dictation key and arm the safety restore. A repeated start
   * (renderer reload, lost UI state) refreshes the window instead of returning
   * immediately, so a nearly-expired timer cannot end the fresh recording.
   */
  async start(): Promise<HotkeyCaptureStartResult> {
    if (this.active) {
      this.arm()
      return { ok: true }
    }
    try {
      await this.deps.source.stop()
    } catch (error) {
      return {
        ok: false,
        message: `无法暂停当前快捷键：${error instanceof Error ? error.message : String(error)}`
      }
    }
    this.active = true
    this.deps.setMenuShortcutsIgnored?.(true)
    // The source's `stop` is `unregisterAll`, which also removed the copy
    // panel's Escape; let it drop the now-false hint immediately.
    this.deps.onRegistrationChanged?.(true)
    this.arm()
    return { ok: true }
  }

  /**
   * Discard the recording and restore the previous accelerator. Idempotent:
   * the safety timer and the renderer's cancel may race, and only one restores.
   */
  async cancel(): Promise<HotkeyCaptureEndResult> {
    this.clearTimer()
    if (!this.active) return { ok: true, accelerator: this.deps.getActive() }
    this.active = false
    this.deps.setMenuShortcutsIgnored?.(false)

    const previous = this.deps.getActive()
    if (previous.length === 0) {
      // Nothing was live before the recording; do not invent a binding.
      this.deps.onRegistrationChanged?.(false)
      return { ok: true, accelerator: '' }
    }

    const outcome = await registerHotkeyWithFallback(this.deps.source, previous)
    // A clean restore of the same binding must not erase a startup fallback
    // notice: the stored preference is still refused even though the live key
    // is unchanged. Only report when the live binding actually moved.
    if (outcome.accelerator !== previous || outcome.message !== undefined) {
      this.deps.setActive(outcome.accelerator, outcome.message)
    }
    this.deps.onRegistrationChanged?.(false)
    return {
      ok: outcome.ok,
      accelerator: outcome.accelerator,
      ...(outcome.message === undefined ? {} : { message: outcome.message })
    }
  }

  /**
   * The user applied a new binding: its registration supersedes the temporary
   * unregistration, so cancel's restore must not run afterwards.
   */
  releaseForApply(): void {
    this.clearTimer()
    this.active = false
    this.deps.setMenuShortcutsIgnored?.(false)
  }

  dispose(): void {
    this.releaseForApply()
  }

  private arm(): void {
    this.clearTimer()
    this.timerHandle = this.deps.timer.set(() => {
      this.timerHandle = undefined
      void this.cancel()
        .then((result) => this.deps.onRestored?.(result))
        .catch((error: unknown) => {
          console.warn('[hotkey] safety restore failed', error)
        })
    }, this.deps.timeoutMs)
  }

  private clearTimer(): void {
    if (this.timerHandle !== undefined) {
      this.deps.timer.clear(this.timerHandle)
      this.timerHandle = undefined
    }
  }
}
