import { describe, expect, it } from 'vitest'
import { AutoCheckScheduler, type SchedulerTimers } from '../src/core/update/scheduler'
import { AUTO_CHECK_INTERVAL_MS, AUTO_CHECK_START_DELAY_MS } from '../src/core/update/policy'

const DAY = AUTO_CHECK_INTERVAL_MS

/**
 * A controllable clock + timer queue. `advance(ms)` fires due timers in order
 * and moves the clock, so a day of scheduling runs instantly and
 * deterministically.
 */
function fakeTimers(startMs = 1_000_000) {
  let now = startMs
  let nextId = 1
  const pending = new Map<number, { at: number; fn: () => void }>()

  const timers: SchedulerTimers = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++
      pending.set(id, { at: now + ms, fn })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout: (handle) => {
      pending.delete(handle as unknown as number)
    }
  }

  const advance = async (ms: number): Promise<void> => {
    const target = now + ms
    for (;;) {
      let due: [number, { at: number; fn: () => void }] | undefined
      for (const entry of pending.entries()) {
        if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) due = entry
      }
      if (!due) break
      pending.delete(due[0])
      now = due[1].at
      due[1].fn()
      await Promise.resolve()
    }
    now = target
  }

  return { timers, advance }
}

function buildHost(overrides: Partial<{
  enabled: boolean
  lastCheckAtMs: number
  permitted: boolean
}> = {}) {
  const state = {
    enabled: overrides.enabled ?? true,
    lastCheckAtMs: overrides.lastCheckAtMs ?? 0,
    permitted: overrides.permitted ?? true,
    checks: 0,
    persisted: [] as number[]
  }
  return {
    state,
    host: {
      enabled: () => state.enabled,
      lastCheckAtMs: () => state.lastCheckAtMs,
      onCheckRan: (atMs: number) => {
        state.lastCheckAtMs = atMs
        state.persisted.push(atMs)
      },
      runCheck: () => {
        state.checks += 1
      },
      permitted: () => state.permitted
    }
  }
}

describe('the scheduler honours the once-per-day policy', () => {
  it('does not arm at all while the toggle is off', async () => {
    const { timers, advance } = fakeTimers()
    const { state, host } = buildHost({ enabled: false })
    new AutoCheckScheduler(host, timers).arm()
    await advance(DAY * 3)
    expect(state.checks).toBe(0)
  })

  it('does not arm in an unsigned build', async () => {
    const { timers, advance } = fakeTimers()
    const { state, host } = buildHost({ permitted: false })
    new AutoCheckScheduler(host, timers).arm()
    await advance(DAY * 3)
    expect(state.checks).toBe(0)
  })

  it('checks after the startup delay and then 24h after that check, not 48h', async () => {
    const { timers, advance } = fakeTimers()
    const { state, host } = buildHost()
    const scheduler = new AutoCheckScheduler(host, timers)
    scheduler.arm()

    await advance(AUTO_CHECK_START_DELAY_MS - 1)
    expect(state.checks).toBe(0)
    await advance(1)
    expect(state.checks).toBe(1)
    expect(state.persisted).toHaveLength(1)

    // Review finding: a fixed interval fired at 24h − 10s and was skipped.
    // The next check must land exactly one interval after the first.
    await advance(DAY - 1)
    expect(state.checks).toBe(1)
    await advance(1)
    expect(state.checks).toBe(2)
  })

  it('does not re-check on restart within the same day', async () => {
    // Simulates: check at T, quit, relaunch at T+len. The persisted last
    // check must suppress the startup check and wait out the remainder.
    const first = fakeTimers()
    const one = buildHost()
    const s1 = new AutoCheckScheduler(one.host, first.timers)
    s1.arm()
    await first.advance(AUTO_CHECK_START_DELAY_MS + 1)
    expect(one.state.checks).toBe(1)

    const restartAt = one.state.lastCheckAtMs + DAY / 2
    const second = fakeTimers(restartAt)
    const two = buildHost({ lastCheckAtMs: one.state.lastCheckAtMs })
    const s2 = new AutoCheckScheduler(two.host, second.timers)
    s2.arm()

    // Startup delay passes, but the day's window is not over yet.
    await second.advance(AUTO_CHECK_START_DELAY_MS + 60_000)
    expect(two.state.checks).toBe(0)

    // When the window ends, the check runs.
    await second.advance(DAY / 2)
    expect(two.state.checks).toBe(1)
  })

  it('persists before running the check, so a crash cannot repeat the day', async () => {
    const { timers, advance } = fakeTimers()
    const calls: string[] = []
    const host = {
      enabled: () => true,
      lastCheckAtMs: () => 0,
      onCheckRan: () => calls.push('persist'),
      runCheck: () => {
        calls.push('check')
        throw new Error('network died')
      },
      permitted: () => true
    }
    const scheduler = new AutoCheckScheduler(host, timers)
    scheduler.arm()
    await advance(AUTO_CHECK_START_DELAY_MS + 1)
    expect(calls[0]).toBe('persist')
    expect(calls[1]).toBe('check')
  })

  it('keeps its schedule after a failed check', async () => {
    const { timers, advance } = fakeTimers()
    let attempts = 0
    const host = {
      enabled: () => true,
      lastCheckAtMs: () => 0,
      onCheckRan: () => undefined,
      runCheck: () => {
        attempts += 1
        throw new Error('network died')
      },
      permitted: () => true
    }
    const scheduler = new AutoCheckScheduler(host, timers)
    scheduler.arm()
    await advance(AUTO_CHECK_START_DELAY_MS + 1)
    expect(attempts).toBe(1)
    // A thrown check must not become an unhandled rejection nor stop the
    // next day's tick.
    await advance(DAY)
    expect(attempts).toBe(2)
  })

  it('does not check instantly when the window already elapsed at startup', async () => {
    // Review follow-up: an app closed for two days must still wait the settle
    // delay, not fire at T+0.
    const { timers, advance } = fakeTimers()
    const staleCheck = 1_000_000 - DAY * 2
    const { state, host } = buildHost({ lastCheckAtMs: staleCheck })
    const scheduler = new AutoCheckScheduler(host, timers)
    scheduler.arm()

    await advance(AUTO_CHECK_START_DELAY_MS - 1)
    expect(state.checks).toBe(0)
    await advance(1)
    expect(state.checks).toBe(1)
  })

  it('stops on teardown', async () => {
    const { timers, advance } = fakeTimers()
    const { state, host } = buildHost()
    const scheduler = new AutoCheckScheduler(host, timers)
    scheduler.arm()
    scheduler.stop()
    await advance(DAY * 2)
    expect(state.checks).toBe(0)
  })
})
