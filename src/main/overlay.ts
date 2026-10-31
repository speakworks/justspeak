import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { indicatorBounds } from '../core/overlay/position'

/**
 * The recording pill: a non-activating panel that floats over every other app.
 *
 * Two rules shape this file. It must never take focus (the user is typing into
 * another application), and it must be visible from the first recording of a
 * session — a lazily created window that misses its only state push would look
 * exactly like the bug this feature exists to fix. Hence the retained state and
 * the `overlay:ready` handshake.
 */

export type OverlayState = 'recording' | 'working'

export interface OverlayPayload {
  state: OverlayState
  theme: 'light' | 'dark'
}

export interface OverlayHost {
  /** Absolute path to the built preload script. */
  preloadPath: string
  /** Dev server URL, when running under `electron-vite dev`. */
  rendererUrl?: string
  /** Built renderer entry for a packaged or previewed app. */
  rendererFile: string
}

let host: OverlayHost | null = null
let window: BrowserWindow | null = null
let retained: OverlayPayload | null = null
let hideTimer: NodeJS.Timeout | null = null

export function initOverlay(next: OverlayHost): void {
  host = next
}

/** The overlay's webContents id, for sender gating in the IPC handlers. */
export function overlayWebContentsId(): number | null {
  return window && !window.isDestroyed() ? window.webContents.id : null
}

function push(): void {
  if (!window || window.isDestroyed() || !retained) return
  window.webContents.send('overlay:state', retained)
}

function ensureWindow(): BrowserWindow {
  if (window && !window.isDestroyed()) return window
  if (!host) throw new Error('overlay host not initialised')

  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const bounds = indicatorBounds(area)

  const created = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    // A panel is the only window type macOS lets float above everything without
    // activating the app; `focusable: false` is what keeps the caret where it is.
    type: 'panel',
    focusable: false,
    webPreferences: {
      preload: host.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  created.setAlwaysOnTop(true, 'status')
  created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.webContents.on('will-navigate', (event) => {
    // The overlay only ever renders its own bundle.
    event.preventDefault()
  })
  created.webContents.on('did-finish-load', () => {
    push()
  })
  created.webContents.on('did-fail-load', (_event, code, description) => {
    console.warn('[overlay] load failed', code, description)
    // Destroy rather than hide: a hidden broken window would be re-shown on the
    // next recording and stay blank forever. Destroying lets the next show
    // rebuild and reload it.
    destroyOverlay()
  })

  if (host.rendererUrl) {
    void created.loadURL(`${host.rendererUrl}?overlay=1`)
  } else {
    void created.loadFile(path.join(host.rendererFile), { search: 'overlay=1' })
  }

  window = created
  created.on('closed', () => {
    window = null
  })
  return created
}

/** Show the pill in `state`. Repeated calls are cheap and update in place. */
export function showOverlay(payload: OverlayPayload): void {
  retained = payload
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  const target = ensureWindow()
  if (!target.isVisible()) {
    // Reposition per show: the pointer may have moved to another display.
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    target.setBounds(indicatorBounds(area))
    target.showInactive()
  }
  push()
}

/** Re-push the retained state; called when the pill reports it has mounted. */
export function replayOverlay(): void {
  push()
}

/** Push the live level to the pill; the caller throttles. */
export function updateOverlayLevel(level: number): void {
  if (!window || window.isDestroyed() || !window.isVisible()) return
  window.webContents.send('overlay:level', level)
}

/**
 * Hide after a short delay so the pill's own exit animation can play. Showing
 * again in the meantime cancels the pending hide.
 */
export function hideOverlay(delayMs = 200): void {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    hideTimer = null
    if (window && !window.isDestroyed()) window.hide()
  }, delayMs)
}

/** Called when the main window closes, so `window-all-closed` keeps working. */
export function destroyOverlay(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (window && !window.isDestroyed()) window.destroy()
  window = null
}
