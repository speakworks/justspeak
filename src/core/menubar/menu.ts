import type { AppState } from '../../shared/ipc'

/**
 * What the menu-bar icon offers once the main window is closed.
 *
 * The window is the app's only other surface, so the menu has to carry every
 * action a resident user needs without it: get back to the window, dictate, and
 * quit. Settings lives in the window, so that item opens the window rather than
 * duplicating an entry point.
 *
 * A dictation item that silently did nothing would be worse than no item, so it
 * follows the same rule the hotkey does — starting is only possible from `idle`
 * or `error`, and stopping only from `recording`. While a transcript is in
 * flight the item is disabled and says so.
 */
export type TrayAction = 'toggle-window' | 'toggle-dictation' | 'open-settings' | 'quit'

export interface TrayMenuItem {
  id: TrayAction
  label: string
  enabled: boolean
}

export interface TrayMenuInput {
  /** Whether the main window is on screen (visible and not minimized). */
  windowVisible: boolean
  dictation: AppState
}

/** The icon's hover text: the hotkey is the point of the app, so name it. */
export function trayTooltip(hotkey: string): string {
  return hotkey === '' ? 'JustSpeak' : `JustSpeak — ${hotkey} 开始听写`
}

export function trayMenu(input: TrayMenuInput): TrayMenuItem[] {
  // `rendererReady` is unavailable here, but a hidden window keeps its live
  // renderer, so both start and stop are meaningful from the menu.
  const canStart = input.dictation === 'idle' || input.dictation === 'error'

  const dictation: TrayMenuItem =
    input.dictation === 'recording'
      ? { id: 'toggle-dictation', label: '结束听写', enabled: true }
      : input.dictation === 'transcribing' || input.dictation === 'pasting'
        ? { id: 'toggle-dictation', label: '正在识别…', enabled: false }
        : { id: 'toggle-dictation', label: '开始听写', enabled: canStart }

  return [
    {
      id: 'toggle-window',
      label: input.windowVisible ? '隐藏主窗口' : '显示主窗口',
      enabled: true
    },
    dictation,
    { id: 'open-settings', label: '设置…', enabled: true },
    { id: 'quit', label: '退出 JustSpeak', enabled: true }
  ]
}

/**
 * Whether closing the main window ends the app or only hides the window.
 *
 * Resident means the icon, the hotkey and the dictation pipeline keep running
 * with no window on screen; the app is then quit from the menu. A quit that the
 * user requested must never be turned into a hide, or `Cmd+Q` and the menu's
 * own quit item would appear to do nothing.
 */
export function closeAction(input: { quitting: boolean }): 'hide' | 'quit' {
  return input.quitting ? 'quit' : 'hide'
}
