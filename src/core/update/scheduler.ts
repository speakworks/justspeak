/**
 * The automatic update-check scheduler, free of Electron.
 *
 * The spec (`app-update`) requires: when 自动检查更新 is on, at most one check
 * per day, anchored on the *persisted* last-check time so a restart does not
 * reset the clock. That rule is pure logic; the controller in main supplies
 * the network call and the preferences store, and tests supply fake timers.
 */
import {
  AUTO_CHECK_START_DELAY_MS,
  nextAutoCheckDelayMs,
  shouldAutoCheck
} from './policy'

export interface SchedulerHost {
  /** Whether the toggle is on. */
  enabled: () => boolean
  /** The persisted last automatic check (0 = never). */
  lastCheckAtMs: () => number
  /** Persist "a check ran at this moment" before the check itself. */
  onCheckRan: (atMs: number) => void
  /** Run the check (the controller's `check()`). */
  runCheck: () => void | Promise<void>
  /** Whether the build may check at all (signed). */
  permitted: () => boolean
}

/** Injected so tests can drive time without real timers. */
export interface SchedulerTimers {
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void
  now: () => number
}

export const REAL_TIMERS: SchedulerTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
  now: () => Date.now()
}

export class AutoCheckScheduler {
  private startupTimer: ReturnType<typeof setTimeout> | undefined
  private dailyTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly host: SchedulerHost,
    private readonly timers: SchedulerTimers = REAL_TIMERS
  ) {}

  /** (Re)arm from the current policy. Safe to call any number of times. */
  arm(): void {
    this.stop()
    if (!this.host.enabled() || !this.host.permitted()) return
    this.startupTimer = this.timers.setTimeout(() => {
      this.startupTimer = undefined
      void this.tick()
    }, AUTO_CHECK_START_DELAY_MS)
    // If the day's window already elapsed (e.g. the app was closed for two
    // days), the startup timer will run the check and re-arm — arming a
    // zero-delay daily timer here would check instantly, before the intended
    // settle delay.
    const delay = nextAutoCheckDelayMs({
      lastCheckAtMs: this.host.lastCheckAtMs(),
      nowMs: this.timers.now()
    })
    if (delay > 0) this.armNextDaily()
  }

  stop(): void {
    if (this.startupTimer !== undefined) this.timers.clearTimeout(this.startupTimer)
    if (this.dailyTimer !== undefined) this.timers.clearTimeout(this.dailyTimer)
    this.startupTimer = undefined
    this.dailyTimer = undefined
  }

  /** One timer tick: check whether due, run, then re-arm the remainder. */
  async tick(): Promise<void> {
    if (!this.host.enabled() || !this.host.permitted()) return
    const nowMs = this.timers.now()
    if (
      !shouldAutoCheck({
        enabled: true,
        lastCheckAtMs: this.host.lastCheckAtMs(),
        nowMs
      })
    ) {
      // A restart shortly after a check: wait out the remainder instead of
      // checking early once the startup delay elapses.
      this.armNextDaily()
      return
    }
    // Persist before the network call: a crash mid-check must not forget that
    // the day's check already happened.
    this.host.onCheckRan(nowMs)
    try {
      await this.host.runCheck()
    } catch (error) {
      // A failed check must not break the schedule or become an unhandled
      // rejection; the controller reports errors to the settings row.
      console.warn('[update] automatic check failed:', error)
    }
    this.armNextDaily()
  }

  private armNextDaily(): void {
    if (this.dailyTimer !== undefined) {
      this.timers.clearTimeout(this.dailyTimer)
      this.dailyTimer = undefined
    }
    if (!this.host.enabled() || !this.host.permitted()) return
    const delay = nextAutoCheckDelayMs({
      lastCheckAtMs: this.host.lastCheckAtMs(),
      nowMs: this.timers.now()
    })
    this.dailyTimer = this.timers.setTimeout(() => {
      this.dailyTimer = undefined
      void this.tick()
    }, delay)
  }
}
