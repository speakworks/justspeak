import type { AppStatus } from '../../shared/ipc'

export interface StateNotice {
  message: string | undefined
  pending: string | undefined
}

/**
 * A partial segmented transcript is a provider success, so the failed segment
 * has no error channel of its own. The main process stores the message and it
 * must surface exactly once, on the next idle state; an error state keeps its
 * own more urgent message. Every other state leaves the notice pending for the
 * terminal state that follows, so it cannot leak into an unrelated session.
 */
export function consumePendingNotice(
  next: AppStatus['state'],
  message: string | undefined,
  pending: string | undefined
): StateNotice {
  if (next !== 'idle' && next !== 'error') return { message, pending }
  return {
    message: next === 'idle' && pending ? pending : message,
    pending: undefined
  }
}
