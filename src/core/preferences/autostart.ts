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
  if (readBack.openAtLogin === requested) {
    return { ok: true, openAtLogin: readBack.openAtLogin }
  }
  return {
    ok: false,
    openAtLogin: readBack.openAtLogin,
    message: requested ? LOGIN_ITEM_REFUSED_ON_REASON : LOGIN_ITEM_REFUSED_OFF_REASON
  }
}
