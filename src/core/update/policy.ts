/**
 * Pure scheduling policy for the automatic update check.
 *
 * The user's policy (from the OpenSpec `app-update` capability): the check is
 * manual by default; when 自动检查更新 is on, the app checks at most once per
 * day — on startup and every 24 hours after. Keeping the decision pure makes
 * the "at most once per day" rule testable without timers or the network.
 */

export function isUpdateAutoCheckEnabled(value: unknown): boolean {
  return value === true
}

/**
 * Whether an automatic check should run right now.
 *
 * A manual check never goes through this: the button is always allowed. This
 * function answers only for the background path.
 */
export function shouldAutoCheck({
  enabled,
  lastCheckAtMs,
  nowMs
}: {
  enabled: boolean
  /** Epoch ms of the last automatic check; 0 when the app has never checked. */
  lastCheckAtMs: number
  nowMs: number
}): boolean {
  if (!enabled) return false
  if (!Number.isFinite(nowMs)) return false
  if (lastCheckAtMs <= 0) return true
  if (lastCheckAtMs > nowMs) return true
  return nowMs - lastCheckAtMs >= AUTO_CHECK_INTERVAL_MS
}

/**
 * How long to wait before the next automatic tick.
 *
 * Scheduling from the *last check* rather than from a fixed 24 h interval is
 * what keeps the promise exact: the startup check runs at T+10 s, so an
 * interval timer started at T would fire at 24 h − 10 s and be skipped by
 * `shouldAutoCheck`, pushing the second check to 48 h. Never returns more than
 * one interval; a never-checked app waits for the interval from now.
 */
export function nextAutoCheckDelayMs({
  lastCheckAtMs,
  nowMs
}: {
  lastCheckAtMs: number
  nowMs: number
}): number {
  if (lastCheckAtMs <= 0 || lastCheckAtMs > nowMs) return AUTO_CHECK_INTERVAL_MS
  return Math.max(0, AUTO_CHECK_INTERVAL_MS - (nowMs - lastCheckAtMs))
}

/** Startup delay for the background check: after the app is visibly settled. */
export const AUTO_CHECK_START_DELAY_MS = 10_000
/** At most once per day. */
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
