/**
 * Pure decisions for the macOS login item (OpenSpec `login-item-autostart`).
 *
 * Electron owns the truth here: `preferences.json` only records whether a
 * choice has been made. These helpers decide when the first-run default is
 * applied and whether a write actually took effect, without importing
 * Electron, so both questions are testable with a plain object.
 */

import type { LoginItemView } from '../../shared/ipc'

export const LOGIN_ITEM_UNAVAILABLE_REASON = '系统没有提供登录项设置。'
export const LOGIN_ITEM_REFUSED_ON_REASON =
  '系统没有接受开机自启设置；未签名或未放入「应用程序」的构建可能不支持。'
export const LOGIN_ITEM_REFUSED_OFF_REASON =
  '系统仍报告开机自启已开启，可能需要在系统设置中手动关闭。'
export const LOGIN_ITEM_REQUIRES_APPROVAL_REASON =
  '等待在系统设置 → 通用 → 登录项中允许开机自启。'

export interface StartupAutostartPlan {
  /**
   * True only on the first run, when `preferences.json` carries no
   * `launchAtLogin` key. Once a choice exists — including `false` — startup
   * must not touch the OS setting, so a manual disable in System Settings
   * survives.
   */
  seedDefault: boolean
}

export function planStartupAutostart(stored: boolean | undefined): StartupAutostartPlan {
  return { seedDefault: stored === undefined }
}

export interface AutostartWriteResult {
  /** True only when the system's read-back equals the requested value. */
  ok: boolean
  /** The system's state after the call; absent when it could not be read. */
  openAtLogin?: boolean
  message?: string
}

/**
 * Judge a toggle from the system's read-back, never from the requested value.
 * A refused change is a real failure: the UI keeps showing the OS state.
 *
 * `requires-approval` is its own outcome: macOS has recorded the request but
 * waits for the user to allow it in System Settings. Treating that as a plain
 * "refused" would point the user at the wrong fix.
 */
export function resolveAutostartWrite(
  requested: boolean,
  readBack: LoginItemView
): AutostartWriteResult {
  if (!readBack.available) {
    return {
      ok: false,
      message: readBack.message ?? LOGIN_ITEM_UNAVAILABLE_REASON
    }
  }
  // Turning it off is satisfied whenever the OS reports off, even while an
  // approval is still pending.
  if (!requested && !readBack.openAtLogin) {
    return { ok: true, openAtLogin: false }
  }
  if (requested && readBack.status === 'requires-approval') {
    return {
      ok: false,
      openAtLogin: false,
      message: LOGIN_ITEM_REQUIRES_APPROVAL_REASON
    }
  }
  if (readBack.openAtLogin === requested) {
    return { ok: true, openAtLogin: readBack.openAtLogin }
  }
  return {
    ok: false,
    openAtLogin: readBack.openAtLogin,
    message: requested ? LOGIN_ITEM_REFUSED_ON_REASON : LOGIN_ITEM_REFUSED_OFF_REASON
  }
}

/** The OS calls the autostart wiring needs; injected so tests can observe them. */
export interface AutostartPorts {
  read: () => LoginItemView
  set: (openAtLogin: boolean) => AutostartWriteResult
  persist: (openAtLogin: boolean) => Promise<void> | void
}

/**
 * First-run seeding. Only a value the OS confirmed is persisted; an
 * unconfirmed seed leaves `launchAtLogin` absent so the next launch retries.
 * Storing an unconfirmed read-back as "the user chose off" would disable the
 * default forever for unsigned or not-yet-approved builds.
 *
 * A stored choice — including `false` — returns without touching the OS.
 */
export async function seedAutostartOnFirstRun(
  stored: boolean | undefined,
  ports: AutostartPorts
): Promise<AutostartWriteResult | undefined> {
  if (!planStartupAutostart(stored).seedDefault) return undefined
  const applied = ports.set(true)
  if (applied.ok && applied.openAtLogin !== undefined) {
    await ports.persist(applied.openAtLogin)
  }
  return applied
}

/**
 * Apply an explicit toggle. The value persisted is the read-back, never the
 * requested value, and a refused change persists nothing.
 */
export async function applyAutostartChoice(
  requested: boolean,
  ports: Pick<AutostartPorts, 'set' | 'persist'>
): Promise<AutostartWriteResult> {
  const applied = ports.set(requested)
  if (applied.ok && applied.openAtLogin !== undefined) {
    await ports.persist(applied.openAtLogin)
  }
  return applied
}

/**
 * Build one read of the OS state for the preferences view. Deliberately takes
 * a reader function instead of a cached value: `preferences:get` must ask the
 * OS every time, so an external change in System Settings shows up.
 */
export function readAutostartView(
  read: () => LoginItemView,
  notice?: string
): LoginItemView {
  const current = read()
  return current.available && notice !== undefined
    ? { ...current, message: notice }
    : current
}
