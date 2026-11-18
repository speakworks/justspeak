/**
 * Thin adapter over Electron's macOS login-item API (OpenSpec
 * `login-item-autostart`).
 *
 * The decisions live in `src/core/preferences/autostart.ts`; this file only
 * performs the OS calls. Two rules it enforces:
 *
 * 1. A read never throws — a missing API or a thrown call becomes
 *    `available: false` with a reason, so startup and the settings read survive.
 * 2. A write is judged by a subsequent read, never by the requested value.
 */

import { app } from 'electron'
import {
  resolveAutostartWrite,
  type AutostartWriteResult
} from '../core/preferences/autostart'
import type { LoginItemView } from '../shared/ipc'

/** The slice of Electron's `app` this adapter needs; injectable for tests. */
export interface LoginItemApi {
  getLoginItemSettings: () => { openAtLogin: boolean }
  setLoginItemSettings: (settings: { openAtLogin: boolean }) => void
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class LoginItemController {
  constructor(private readonly api: LoginItemApi) {}

  /** The OS's current answer, never a cached preference. */
  read(): LoginItemView {
    try {
      const settings = this.api.getLoginItemSettings()
      return { available: true, openAtLogin: settings.openAtLogin === true }
    } catch (error) {
      return {
        available: false,
        openAtLogin: false,
        message: `无法读取登录项状态：${reason(error)}`
      }
    }
  }

  /**
   * Apply the requested value, then re-read. Success requires the OS to report
   * the requested state; a refused change is returned as a failure.
   */
  set(openAtLogin: boolean): AutostartWriteResult {
    try {
      this.api.setLoginItemSettings({ openAtLogin })
    } catch (error) {
      return { ok: false, message: `无法写入登录项设置：${reason(error)}` }
    }
    return resolveAutostartWrite(openAtLogin, this.read())
  }
}

export function createLoginItemController(): LoginItemController {
  return new LoginItemController({
    getLoginItemSettings: () => app.getLoginItemSettings(),
    setLoginItemSettings: (settings) => app.setLoginItemSettings(settings)
  })
}
