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

/** Startup delay for the background check: after the app is visibly settled. */
export const AUTO_CHECK_START_DELAY_MS = 10_000
/** At most once per day. */
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
