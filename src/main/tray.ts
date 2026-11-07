import { Menu, Tray, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import path from 'node:path'
import { trayMenu, trayTooltip, type TrayAction } from '../core/menubar/menu'
import type { AppState } from '../shared/ipc'

/**
 * The menu-bar icon.
 *
 * Two decisions this file carries:
 *
 * 1. The tray is created once and kept for the process lifetime. Rebuilding it
 *    on every state change makes the icon flicker out of the menu bar on macOS,
 *    which reads as the app crashing.
 * 2. The template image is loaded from disk as a `NativeImage` and marked
 *    `setTemplateImage(true)`. The name suffix alone is only a hint; the flag is
 *    what makes macOS invert the mark for a dark menu bar and follow the
 *    reduced-transparency setting.
 */

export interface TrayHost {
  /** Absolute path to the directory holding `trayTemplate.png`. */
  iconDir: string
  /** The window the menu controls; null only during teardown. */
  window: () => BrowserWindow | null
  dictation: () => AppState
  hotkey: () => string
  onToggleWindow: () => void
  onToggleDictation: () => void
  onOpenSettings: () => void
  onQuit: () => void
}

let tray: Tray | null = null
let host: TrayHost | null = null
let lastMenuSignature = ''

/** `@2x` sits next to the 1x file and Electron picks it from the same path. */
function templateImage(iconDir: string): NativeImage {
  const image = nativeImage.createFromPath(path.join(iconDir, 'trayTemplate.png'))
  image.setTemplateImage(true)
  return image
}

function windowVisible(): boolean {
  const window = host?.window()
  if (!window || window.isDestroyed()) return false
  return window.isVisible() && !window.isMinimized()
}

function dispatch(action: TrayAction): void {
  if (!host) return
  if (action === 'toggle-window') host.onToggleWindow()
  else if (action === 'toggle-dictation') host.onToggleDictation()
  else if (action === 'open-settings') host.onOpenSettings()
  else host.onQuit()
}

/**
 * Rebuild the menu only when its rendered content changes.
 *
 * `Tray.setContextMenu` closes an open menu, so calling it on every session
 * state change would dismiss the menu while the user is reading it. The
 * signature covers every value the labels and enabled flags derive from.
 */
function renderMenu(): void {
  if (!tray || !host) return
  const input = { windowVisible: windowVisible(), dictation: host.dictation() }
  const items = trayMenu(input)
  const signature = JSON.stringify(items)
  if (signature === lastMenuSignature) return
  lastMenuSignature = signature
  tray.setContextMenu(
    Menu.buildFromTemplate(
      items.map((item) => ({
        label: item.label,
        enabled: item.enabled,
        click: () => dispatch(item.id)
      }))
    )
  )
}

export function createTray(next: TrayHost): void {
  if (tray) {
    tray.destroy()
    tray = null
    lastMenuSignature = ''
  }
  host = next
  tray = new Tray(templateImage(next.iconDir))
  tray.setToolTip(trayTooltip(next.hotkey()))
  // No `click` handler here. With a context menu set, macOS treats a left
  // click as "open the menu" — but Electron still also emits `click`, and a
  // handler on it would fire *in addition to* the menu appearing. A handler
  // that shows or focuses the main window would therefore steal focus (it
  // activates the app) at the exact moment the user is picking an item —
  // dictating into another app would land the transcript in JustSpeak's own
  // input instead. The menu itself carries 显示主窗口 for reaching the window.
  renderMenu()
}

/** Push a new session state, window visibility, or hotkey into the menu. */
export function refreshTray(): void {
  if (!tray || !host) return
  tray.setToolTip(trayTooltip(host.hotkey()))
  renderMenu()
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
  host = null
  lastMenuSignature = ''
}
