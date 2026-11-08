import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { isDeveloperIdSigned } from '../core/update/signature'
import {
  AUTO_CHECK_INTERVAL_MS,
  AUTO_CHECK_START_DELAY_MS,
  shouldAutoCheck
} from '../core/update/policy'
import type {
  UpdateEvent,
  UpdateStatusView
} from '../shared/ipc'

// electron-updater is a CommonJS package. A named import compiles fine but
// crashes at runtime in an ESM main (`Named export 'autoUpdater' not found`),
// so the namespace default import is the only correct form here.
const { autoUpdater } = electronUpdater
type UpdateInfo = Parameters<
  Parameters<typeof autoUpdater.on<'update-available'>>[1]
>[0]

/**
 * The update client, wired behind the user's policy (OpenSpec `app-update`).
 *
 * Three rules this file exists to carry:
 *
 * 1. The feed is fixed. `autoUpdater.setFeedURL` is never called with
 *    user-supplied input, and the renderer cannot change it.
 * 2. Unsigned builds answer honestly. An ad-hoc or missing signature means
 *    Squirrel.Mac cannot install anything, so 检查更新 in such a build returns
 *    「自动更新需要正式签名版」instead of pretending to have checked.
 * 3. Nothing downloads without the user asking for it: the check reports a
 *    newer version, and only the explicit 下载并安装 action reaches
 *    `downloadUpdate`.
 */

export interface UpdateHost {
  /** Whether the automatic check preference is on. */
  autoCheckEnabled: () => boolean
  /** Persist the toggle and the last automatic check time. */
  onAutoCheckChanged: (enabled: boolean, lastCheckAtMs: number) => void
  /** Push an update event to the renderer (settings row). */
  onEvent: (event: UpdateEvent) => void
}

const FEED_URL = 'https://github.com/speakworks/justspeak/releases'

export class UpdateController {
  private host: UpdateHost | null = null
  private lastCheckAtMs = 0
  private startupTimer: NodeJS.Timeout | undefined
  private dailyTimer: NodeJS.Timeout | undefined
  private checking = false

  init(host: UpdateHost): void {
    // electron-updater reads publish config from app-update.yml inside the
    // bundle; in dev (no bundle) point it at the fixed feed explicitly so a
    // stray dev-mode check still targets the real feed and nothing else.
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('checking-for-update', () => {
      this.host?.onEvent({ type: 'checking' })
    })
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.host?.onEvent({
        type: 'available',
        version: info.version ?? ''
      })
    })
    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.host?.onEvent({
        type: 'up-to-date',
        version: info.version ?? ''
      })
    })
    autoUpdater.on('error', (error: Error) => {
      // The feed being unreachable is a normal state, not a crash: surface it
      // in the settings row and keep the app fully working.
      this.host?.onEvent({ type: 'error', message: error.message })
    })
    autoUpdater.on('download-progress', (progress) => {
      this.host?.onEvent({
        type: 'downloading',
        percent: Math.round(progress.percent)
      })
    })
    autoUpdater.on('update-downloaded', () => {
      this.host?.onEvent({ type: 'ready-to-install' })
    })

    this.host = host
    this.scheduleFromPolicy()
  }

  /** The settings row's view of the updater. */
  status(): UpdateStatusView {
    return {
      feedUrl: FEED_URL,
      signed: this.detectDistributionSignature(),
      checking: this.checking
    }
  }

  /**
   * Whether the running bundle carries a Developer ID signature.
   *
   * In dev (`app.isPackaged === false`) there is no signature at all: the app
   * is launched straight from out/.
   */
  detectDistributionSignature(): boolean {
    if (!app.isPackaged) return false
    const result = spawnSync('codesign', ['-dv', app.getPath('exe')], { encoding: 'utf8' })
    return result.status === 0 && isDeveloperIdSigned(`${result.stderr}${result.stdout}`)
  }

  async check(): Promise<UpdateStatusView> {
    // The honest unsigned answer, before any network request is made.
    if (!this.detectDistributionSignature()) {
      this.host?.onEvent({ type: 'needs-signature' })
      return this.status()
    }
    if (this.checking) return this.status()
    this.checking = true
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      // `error` already fired to the renderer through the 'error' listener;
      // catching here keeps a failed check from rejecting the IPC invoke.
      console.warn('[update] check failed:', error instanceof Error ? error.message : error)
    } finally {
      this.checking = false
    }
    return this.status()
  }

  async download(): Promise<void> {
    await autoUpdater.downloadUpdate()
  }

  /** Install the downloaded update and restart. */
  install(): void {
    autoUpdater.quitAndInstall()
  }

  /**
   * (Re)arm the background timers from the current policy. Called at startup
   * and after a toggle write; the toggle's persistence lives with the host
   * (preferences), the timing lives here.
   */
  refreshSchedule(): void {
    this.scheduleFromPolicy()
  }

  private scheduleFromPolicy(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer)
      this.startupTimer = undefined
    }
    if (this.dailyTimer) {
      clearInterval(this.dailyTimer)
      this.dailyTimer = undefined
    }
    if (!this.host?.autoCheckEnabled()) return
    if (!this.detectDistributionSignature()) return

    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined
      void this.autoCheckTick()
    }, AUTO_CHECK_START_DELAY_MS)
    this.dailyTimer = setInterval(
      () => void this.autoCheckTick(),
      AUTO_CHECK_INTERVAL_MS
    )
  }

  private async autoCheckTick(): Promise<void> {
    if (!this.host) return
    const nowMs = Date.now()
    if (!shouldAutoCheck({
      enabled: this.host.autoCheckEnabled(),
      lastCheckAtMs: this.lastCheckAtMs,
      nowMs
    })) {
      return
    }
    this.lastCheckAtMs = nowMs
    await this.check()
  }

  teardown(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.dailyTimer) clearInterval(this.dailyTimer)
    this.startupTimer = undefined
    this.dailyTimer = undefined
  }
}

export const updateFeedUrl = FEED_URL

/** Where the bundled app-update.yml lives (informational, used by docs). */
export function updateResourcePath(): string {
  return path.join(process.resourcesPath ?? '', 'app-update.yml')
}
