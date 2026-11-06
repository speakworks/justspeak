/**
 * The session-state gate for changing the dictation binding, independent of
 * Electron.
 *
 * Both paths that can change the binding share this decision: arming a capture,
 * which unregisters the dictation key so the renderer can receive the chord,
 * and applying a typed accelerator. Doing either mid-session would leave a live
 * recording or an in-flight transcript with no way to stop or deliver, so a
 * change is refused unless the session is idle or already failed. Keeping the
 * decision here lets the state table be tested without spawning Electron or
 * faking IPC senders.
 */

import type { AppState } from '../../shared/ipc'

export const HOTKEY_CHANGE_BUSY_MESSAGE = '录音或识别过程中不能更改快捷键。'

/** The refusal message for this state, or `null` when the binding may change. */
export function hotkeyChangeRefusal(state: AppState): string | null {
  return state === 'idle' || state === 'error' ? null : HOTKEY_CHANGE_BUSY_MESSAGE
}
