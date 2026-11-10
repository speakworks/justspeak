import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { spawnSync } from 'node:child_process'
import { isDeveloperIdSigned } from '../core/update/signature'
import { AutoCheckScheduler } from '../core/update/scheduler'
import type { UpdateEvent, UpdateStatusView } from '../shared/ipc'

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
 * Four rules this file carries:
 *
 * 1. The feed is fixed. `autoUpdater.setFeedURL` is never called; the feed
 *    comes from the bundled `app-update.yml` (electron-builder's `publish:`
 *    block) and the renderer cannot change it.
 * 2. Unsigned builds answer honestly. Without a valid Developer ID signature
 *    the check returns 「自动更新需要正式签名版」 before any network request,
 *    and the background schedule never arms.
 * 3. Nothing downloads without the user asking for it: only a check that
 *    reported `available` unlocks `downloadUpdate`, and only a finished
 *    download unlocks `quitAndInstall`.
 * 4. "At most once per day" survives restarts: the scheduler (pure module)
 *    anchors on the persisted last-check time.
 */

export interface UpdateHost {
  /** Whether the automatic check preference is on. */
  autoCheckEnabled: () => boolean
  /** Epoch ms of the last automatic check, from the persisted preference. */
  lastCheckAtMs: () => number
  /** Persist the moment an automatic check ran (host writes preferences). */
  onAutoCheckRan: (atMs: number) => void
  /** Push an update event to the renderer (settings row). */
  onEvent: (event: UpdateEvent) => void
}

const FEED_URL = 'https://github.com/speakworks/justspeak/releases'

export class UpdateController {
  private host: UpdateHost | null = null
  private scheduler: AutoCheckScheduler | undefined
  private checking = false
  /** Set only by an `available` event; cleared by a later successful check. */
  private availableVersion: string | undefined
  /** Set only by `update-downloaded`. */
  private downloaded = false

  init(host: UpdateHost): void {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    // The running version is a prerelease (`0.1.0-demo.0`), and the app must
    // still see a future stable release (e.g. `0.2.0`). Without this,
    // electron-updater pins the channel to "demo" and the GitHub provider
    // searches only `-demo` tags.
    autoUpdater.allowPrerelease = true

    autoUpdater.on('checking-for-update', () => {
      this.host?.onEvent({ type: 'checking' })
    })
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.availableVersion = info.version ?? ''
      this.downloaded = false
      this.host?.onEvent({ type: 'available', version: this.availableVersion })
    })
    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.availableVersion = undefined
      this.downloaded = false
      this.host?.onEvent({ type: 'up-to-date', version: info.version ?? '' })
    })
    autoUpdater.on('error', (error: Error) => {
      // The feed being unreachable is a normal state, not a crash: surface it
      // in the settings row and keep the app fully working.
      this.availableVersion = undefined
      this.downloaded = false
      this.host?.onEvent({ type: 'error', message: error.message })
    })
    autoUpdater.on('download-progress', (progress) => {
      this.host?.onEvent({
        type: 'downloading',
        percent: Math.round(progress.percent)
      })
    })
    autoUpdater.on('update-downloaded', () => {
      this.downloaded = true
      this.host?.onEvent({ type: 'ready-to-install' })
    })

    this.host = host
    this.scheduler = new AutoCheckScheduler({
      enabled: host.autoCheckEnabled,
      lastCheckAtMs: host.lastCheckAtMs,
      onCheckRan: host.onAutoCheckRan,
      runCheck: async () => {
        await this.check()
      },
      permitted: () => this.detectDistributionSignature()
    })
    this.scheduler.arm()
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
   * Whether the running bundle carries a valid Developer ID signature.
   *
   * Both conditions are required: `codesign --verify --strict` must succeed
   * (a self-signed certificate whose CN contains "Developer ID" fails here)
   * and the signing chain must name a Developer ID Application authority.
   * In dev (`app.isPackaged === false`) there is no bundle signature at all.
   */
  detectDistributionSignature(): boolean {
    if (!app.isPackaged) return false
    const exe = app.getPath('exe')
    const verify = spawnSync('codesign', ['--verify', '--strict', exe], {
      encoding: 'utf8'
    })
    if (verify.status !== 0) return false
    const info = spawnSync('codesign', ['-dv', '--verbose=4', exe], {
      encoding: 'utf8'
    })
    return info.status === 0 && isDeveloperIdSigned(`${info.stderr}${info.stdout}`)
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

  /**
   * Download the version the last check reported. Refuses unless a check
   * actually reported `available` — the renderer can invoke the IPC handler
   * directly, so the gate lives here, not in the UI.
   */
  async download(): Promise<void> {
    if (this.availableVersion === undefined) {
      throw new Error('没有可下载的更新，请先检查更新。')
    }
    await autoUpdater.downloadUpdate()
  }

  /** Install a finished download and restart. Refuses before that point. */
  install(): void {
    if (!this.downloaded) {
      throw new Error('更新尚未下载完成。')
    }
    autoUpdater.quitAndInstall()
  }

  /** (Re)arm the background schedule after a toggle write. */
  refreshSchedule(): void {
    this.scheduler?.arm()
  }

  teardown(): void {
    this.scheduler?.stop()
  }
}
