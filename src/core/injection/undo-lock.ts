/**
 * The write mutex shared by deletions and every paste into a target app.
 *
 * A guard decision and the keystrokes are asynchronous. Two deletions could
 * both pass the guard, and a paste that lands while the Backspace loop is still
 * running would have its tail deleted. Exactly one writer may hold the lock;
 * pastes wait for a bounded time and are refused rather than writing into a
 * deletion in progress.
 */

export const PASTE_LOCK_TIMEOUT_MS = 1_500
export const PASTE_LOCK_BUSY_MESSAGE =
  '撤销正在进行，暂时无法插入文本。请稍后再试。'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class UndoLock {
  private held = false
  private releaseCurrent: (() => void) | null = null
  /** Resolves when the current holder releases; replaced on each acquisition. */
  private freed: Promise<void> = Promise.resolve()

  get locked(): boolean {
    return this.held
  }

  tryAcquire(): boolean {
    if (this.held) return false
    this.held = true
    this.freed = new Promise<void>((resolve) => {
      this.releaseCurrent = resolve
    })
    return true
  }

  release(): void {
    if (!this.held) return
    this.held = false
    const release = this.releaseCurrent
    this.releaseCurrent = null
    release?.()
  }

  /**
   * Wait for the lock up to `timeoutMs`, then acquire it. Bounded by design:
   * a stuck holder must turn into a refusal, never an unbounded main-process
   * wait. Each release re-checks; a lost race waits again until the deadline.
   */
  async acquire(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, timeoutMs)
    while (true) {
      if (this.tryAcquire()) return true
      const remaining = deadline - Date.now()
      if (remaining <= 0) return false
      await Promise.race([this.freed, delay(remaining)])
    }
  }
}

/**
 * Wrap a paste so it never writes into a target while a deletion holds the
 * lock. A timeout is a refusal with a user-facing reason; the text is not
 * written and the caller's error path records/preserves it.
 */
export function createLockedPaste(
  lock: UndoLock,
  paste: (text: string) => Promise<void>,
  timeoutMs = PASTE_LOCK_TIMEOUT_MS
): (text: string) => Promise<void> {
  return async (text: string): Promise<void> => {
    const acquired = await lock.acquire(timeoutMs)
    if (!acquired) throw new Error(PASTE_LOCK_BUSY_MESSAGE)
    try {
      await paste(text)
    } finally {
      lock.release()
    }
  }
}
