import { describe, expect, it } from 'vitest'
import { HOTKEY_CHANGE_BUSY_MESSAGE, hotkeyChangeRefusal } from '../src/core/hotkey/hotkey-change-guard'
import type { AppState } from '../src/shared/ipc'

/**
 * Keyed by every `AppState`, so adding a state fails to compile until this
 * table answers for it. Only `idle` and `error` may change the binding.
 */
const EXPECTED: Record<AppState, string | null> = {
  idle: null,
  recording: HOTKEY_CHANGE_BUSY_MESSAGE,
  transcribing: HOTKEY_CHANGE_BUSY_MESSAGE,
  pasting: HOTKEY_CHANGE_BUSY_MESSAGE,
  error: null
}

describe('hotkeyChangeRefusal', () => {
  it('refuses every in-flight state and allows a quiet one', () => {
    for (const [state, expected] of Object.entries(EXPECTED)) {
      expect(hotkeyChangeRefusal(state as AppState)).toBe(expected)
    }
  })

  it('uses the user-facing refusal message', () => {
    expect(HOTKEY_CHANGE_BUSY_MESSAGE).toBe('录音或识别过程中不能更改快捷键。')
  })
})
