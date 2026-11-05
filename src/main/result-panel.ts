import { BrowserWindow, clipboard, globalShortcut, screen } from 'electron'
import path from 'node:path'
import { resultPanelBounds } from '../core/overlay/position'
import type { ResolvedTheme, ResultPanelPayload } from '../shared/ipc'

/**
 * The copy panel shown when the frontmost element cannot accept a paste.
 *
 * It follows the recording pill's rules: a non-activating `panel` window at the
 * bottom of the work area, floating above every app, never taking focus. The
 * content is retained until the renderer reports it has mounted, so the first
 * panel after launch cannot appear blank. The panel stays until the user
 * copies, closes it, or presses Escape; Escape is a global shortcut because a
 * non-focusable window can never receive the key itself.
 */

export interface ResultPanelHost {
  preloadPath: string
  rendererUrl?: string
  rendererFile: string
}

let host: ResultPanelHost | null = null
let window: BrowserWindow | null = null
let retained: ResultPanelPayload | null = null
let hideTimer: NodeJS.Timeout | null = null

export function initResultPanel(next: ResultPanelHost): void {
  host = next
}

export function resultPanelWebContentsId(): number | null {
  return window && !window.isDestroyed() ? window.webContents.id : null
}

function registerEscape(): boolean {
  // `isRegistered` is the source of truth: the hotkey source calls
  // `unregisterAll()` when the user changes the dictation shortcut, so a cached
  // boolean would never re-register.
  if (globalShortcut.isRegistered('Escape')) return true
  const registered = globalShortcut.register('Escape', () => hideResultPanel())
  if (!registered) console.warn('[panel] Escape is already registered elsewhere')
  return registered
}

function unregisterEscape(): void {
  if (globalShortcut.isRegistered('Escape')) globalShortcut.unregister('Escape')
}

function push(): void {
  if (!window || window.isDestroyed() || retained === null) return
  window.webContents.send('panel:text', retained)
}

function ensureWindow(): BrowserWindow {
  if (window && !window.isDestroyed()) return window
  if (!host) throw new Error('result panel host not initialised')

  const created = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    roundedCorners: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
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
  created.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  })
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  created.webContents.on('did-finish-load', () => {
    push()
  })
  created.webContents.on('did-fail-load', (_event, code, description) => {
    console.warn('[panel] load failed', code, description)
    destroyResultPanel()
  })
  created.on('closed', () => {
    window = null
    unregisterEscape()
  })

  if (host.rendererUrl) {
    void created.loadURL(`${host.rendererUrl}?panel=1`)
  } else {
    void created.loadFile(path.join(host.rendererFile), { search: 'panel=1' })
  }

  window = created
  return created
}

/** Show the panel with `text`; repeated calls replace the retained content. */
export function showResultPanel(text: string, theme: ResolvedTheme): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  const target = ensureWindow()
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  target.setBounds(resultPanelBounds(area))
  const canEscape = registerEscape()
  retained = { text, theme, canEscape }
  target.showInactive()
  push()
}

/** Called when the panel reports it has mounted, so the retained text is pushed. */
export function replayResultPanel(): void {
  push()
}

/**
 * Re-register Escape after the dictation hotkey source called `unregisterAll`.
 * Without this a visible panel would keep showing the Escape hint while the key
 * no longer works until the next show.
 */
export function refreshResultPanelEscape(): void {
  if (!window || window.isDestroyed() || !window.isVisible() || retained === null) return
  const canEscape = registerEscape()
  if (retained.canEscape === canEscape) return
  retained = { ...retained, canEscape }
  push()
}

/**
 * The dictation hotkey source is about to call `unregisterAll` for a settings
 * capture. Drop the panel's Escape hint without re-registering Escape: that
 * key now belongs to the recorder and cancels the capture instead.
 */
export function suspendResultPanelEscape(): void {
  if (!window || window.isDestroyed() || !window.isVisible() || retained === null) return
  if (!retained.canEscape) return
  retained = { ...retained, canEscape: false }
  push()
}

/** Copy the retained text and dismiss after the button's own feedback frame. */
export function copyResultPanelText(): void {
  if (retained === null) return
  clipboard.writeText(retained.text)
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    hideTimer = null
    hideResultPanel()
  }, 250)
}

export function hideResultPanel(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  unregisterEscape()
  if (window && !window.isDestroyed()) window.hide()
  // History already persisted the text; do not keep a second copy in memory.
  retained = null
}

/** Called when the main window closes, so `window-all-closed` keeps working. */
export function destroyResultPanel(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  unregisterEscape()
  if (window && !window.isDestroyed()) window.destroy()
  window = null
  retained = null
}
