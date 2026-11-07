import { describe, expect, it } from 'vitest'
import { closeAction, trayMenu, trayTooltip } from '../src/core/menubar/menu'
import type { AppState } from '../src/shared/ipc'

const IDS = ['toggle-window', 'toggle-dictation', 'open-settings', 'quit']

function items(state: AppState, windowVisible = true) {
  return trayMenu({ windowVisible, dictation: state })
}

describe('menu-bar dictation item follows the session state', () => {
  it('offers to start from idle and from error', () => {
    for (const state of ['idle', 'error'] as AppState[]) {
      const item = items(state).find((entry) => entry.id === 'toggle-dictation')
      expect(item, state).toMatchObject({ label: '开始听写', enabled: true })
    }
  })

  it('offers to stop only while recording', () => {
    const item = items('recording').find((entry) => entry.id === 'toggle-dictation')
    expect(item).toMatchObject({ label: '结束听写', enabled: true })
  })

  it('disables itself while a transcript is in flight instead of silently doing nothing', () => {
    for (const state of ['transcribing', 'pasting'] as AppState[]) {
      const item = items(state).find((entry) => entry.id === 'toggle-dictation')
      expect(item, state).toMatchObject({ enabled: false })
      expect(item?.label, state).toBe('正在识别…')
    }
  })
})

describe('menu-bar window item names the action it performs', () => {
  it('offers to show a hidden window and to hide a visible one', () => {
    const hidden = trayMenu({ windowVisible: false, dictation: 'idle' })
    expect(hidden.find((entry) => entry.id === 'toggle-window')?.label).toBe('显示主窗口')
    const visible = trayMenu({ windowVisible: true, dictation: 'idle' })
    expect(visible.find((entry) => entry.id === 'toggle-window')?.label).toBe('隐藏主窗口')
  })

  it('always exposes the same four actions in the same order', () => {
    // A resident app must never strand the user without a way back to the
    // window or out of the app, so no state may drop an item.
    for (const state of ['idle', 'recording', 'transcribing', 'pasting', 'error'] as AppState[]) {
      expect(items(state).map((entry) => entry.id), state).toEqual(IDS)
    }
  })
})

describe('tooltip names the live hotkey', () => {
  it('carries the accelerator so the menu bar teaches the shortcut', () => {
    expect(trayTooltip('Command+Shift+Space')).toBe('JustSpeak — Command+Shift+Space 开始听写')
  })

  it('falls back to the product name when no hotkey is registered', () => {
    // An empty accelerator means the OS refused the binding; naming it would
    // send the user to a key that does nothing.
    expect(trayTooltip('')).toBe('JustSpeak')
  })
})

describe('closing the window hides it unless the app is quitting', () => {
  it('hides on a plain close', () => {
    expect(closeAction({ quitting: false })).toBe('hide')
  })

  it('lets a requested quit through', () => {
    // Cmd+Q and the menu's own quit item both arrive here; treating them as a
    // hide would leave the app running with no way the user asked for.
    expect(closeAction({ quitting: true })).toBe('quit')
  })
})
