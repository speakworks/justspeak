import { BrowserWindow, clipboard, globalShortcut, screen } from 'electron'
import path from 'node:path'
import type { FocusTarget } from '../core/focus/editability'
import { resultPanelBounds } from '../core/overlay/position'
import type { ResolvedTheme, ResultPanelPayload } from '../shared/ipc'

/**
 * The correction panel shown when the frontmost element cannot accept a paste.
 *
 * It follows the recording pill's rules on appearance: a `panel` window at the
 * bottom of the work area, floating above every app, shown with
 * `showInactive()` so appearing never steals focus from the target app. The
 * text is editable, so a click can focus it; reinsertion hides the window first
 * and only inserts when the original app reports an editable element again.
 *
 * The content is retained until the renderer reports it has mounted, so the
 * first panel after launch cannot appear blank. The panel stays until the user
 * copies, closes it, or presses Escape; Escape is a global shortcut because the
 * window may be visible but never focused.
 */

export interface ResultPanelHost {
  preloadPath: string
  rendererUrl?: string
  rendererFile: string
}

let host: ResultPanelHost | null = null
let window: BrowserWindow | null = null
let retained: ResultPanelPayload | null = null
/** The history row behind the retained text, when one was written. */
let retainedEntryId: string | undefined
/** The frontmost target at panel-show time, used by reinsertion. */
let retainedTarget: FocusTarget | undefined
/** Changes on every fresh show, so the renderer knows to reset its draft. */
let retainedRevision = 0
let hideTimer: NodeJS.Timeout | null = null

export interface ResultPanelShowOptions {
  title?: string
  notice?: string
  entryId?: string
  target?: FocusTarget
}

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
    // The panel's text is editable (B3). It is still shown with
    // `showInactive()`, so appearing after a failed paste does not steal focus
    // from the app that could not accept the text.
    focusable: true,
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
export function showResultPanel(
  text: string,
  theme: ResolvedTheme,
  options: ResultPanelShowOptions = {}
): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  const target = ensureWindow()
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  target.setBounds(resultPanelBounds(area))
  const canEscape = registerEscape()
  retainedRevision += 1
  retained = {
    text,
    theme,
    canEscape,
    revision: retainedRevision,
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.notice === undefined ? {} : { notice: options.notice })
  }
  retainedEntryId = options.entryId
  retainedTarget = options.target
  target.showInactive()
  push()
}

/** Attach the history row to the timed transcript that is still retained. */
export function attachResultPanelEntry(entryId: string, text: string): void {
  if (retained === null || retained.text !== text) return
  retainedEntryId = entryId
}

/**
 * Remember the target the panel was shown for. The delivery probe answers it,
 * so the panel learns it after `showResultPanel` has already run.
 */
export function setResultPanelTarget(target: FocusTarget): void {
  if (retained === null) return
  retainedTarget = target
}

/**
 * What main needs to decide a reinsertion: the history row and the frontmost
 * target as it was when the panel was shown. `null` once the panel is gone.
 */
export function resultPanelContext(): {
  entryId?: string
  target?: FocusTarget
} | null {
  if (retained === null) return null
  return {
    ...(retainedEntryId === undefined ? {} : { entryId: retainedEntryId }),
    ...(retainedTarget === undefined ? {} : { target: retainedTarget })
  }
}

/** Hide without forgetting the text: reinsertion re-shows it with a notice. */
export function hideResultPanelWindow(): void {
  unregisterEscape()
  if (window && !window.isDestroyed()) window.hide()
}

/** Hide after `ms`, used for the short reinsertion feedback panel. */
export function scheduleResultPanelHide(ms: number): void {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    hideTimer = null
    hideResultPanel()
  }, ms)
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

/** Copy the retained text (or the panel's edited draft) and dismiss. */
export function copyResultPanelText(text?: string): void {
  if (retained === null) return
  clipboard.writeText(text ?? retained.text)
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
  retainedEntryId = undefined
  retainedTarget = undefined
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
  retainedEntryId = undefined
  retainedTarget = undefined
}
