import { describe, expect, it, vi } from 'vitest'
import {
  PASTE_LOCK_BUSY_MESSAGE,
  UndoLock,
  createLockedPaste,
  isPasteLockBusyError
} from '../src/core/injection/undo-lock'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('undo lock', () => {
  it('lets exactly one concurrent caller delete', async () => {
    const lock = new UndoLock()
    const deletions: string[] = []

    const attempt = async (name: string): Promise<string> => {
      if (!lock.tryAcquire()) return 'refused'
      try {
        // Model the probe/exec delay that lets two callers overlap.
        await wait(20)
        deletions.push(name)
        return 'deleted'
      } finally {
        lock.release()
      }
    }

    const results = await Promise.all([attempt('first'), attempt('second')])
    expect(deletions).toHaveLength(1)
    expect(results.filter((value) => value === 'refused')).toHaveLength(1)
    expect(results.filter((value) => value === 'deleted')).toHaveLength(1)
  })

  it('can be reused after the first deletion settles', async () => {
    const lock = new UndoLock()
    expect(lock.tryAcquire()).toBe(true)
    expect(lock.tryAcquire()).toBe(false)
    lock.release()
    expect(lock.locked).toBe(false)
    expect(lock.tryAcquire()).toBe(true)
    lock.release()
  })

  it('releases in a finally after an exec failure, so the lock is never wedged', async () => {
    const lock = new UndoLock()
    expect(lock.tryAcquire()).toBe(true)
    await expect(
      (async () => {
        try {
          throw new Error('exec failed')
        } finally {
          lock.release()
        }
      })()
    ).rejects.toThrow('exec failed')
    expect(lock.locked).toBe(false)
    expect(lock.tryAcquire()).toBe(true)
    lock.release()
  })

  it('makes a paste wait for an in-flight delete instead of interleaving', async () => {
    const lock = new UndoLock()
    const events: string[] = []
    const lockedPaste = createLockedPaste(
      lock,
      async () => {
        events.push('paste')
      },
      500
    )

    // A delete holds the lock while its script runs.
    expect(lock.tryAcquire()).toBe(true)
    events.push('delete-start')
    const timer = setTimeout(() => {
      events.push('delete-end')
      lock.release()
    }, 30)
    await lockedPaste('text')
    clearTimeout(timer)

    expect(events).toEqual(['delete-start', 'delete-end', 'paste'])
  })

  it('is not reentrant: a holder that calls acquire again times out', async () => {
    // This is the hazard the held-lock fallback bypasses: the same logical
    // caller must never re-enter createLockedPaste while holding the lock.
    const lock = new UndoLock()
    expect(lock.tryAcquire()).toBe(true)
    await expect(lock.acquire(25)).resolves.toBe(false)
    expect(lock.locked).toBe(true)
    lock.release()
  })

  it('refuses a paste at the deadline instead of writing into the delete', async () => {
    const lock = new UndoLock()
    const paste = vi.fn(async () => {})
    const lockedPaste = createLockedPaste(lock, paste, 20)

    expect(lock.tryAcquire()).toBe(true)
    const error = await lockedPaste('text').catch((cause: unknown) => cause)
    expect(isPasteLockBusyError(error)).toBe(true)
    expect((error as Error).message).toBe(PASTE_LOCK_BUSY_MESSAGE)
    expect(paste).not.toHaveBeenCalled()
    lock.release()
  })

  it('releases the lock when the paste itself throws', async () => {
    const lock = new UndoLock()
    const lockedPaste = createLockedPaste(
      lock,
      async () => {
        throw new Error('paste failed')
      },
      100
    )
    await expect(lockedPaste('text')).rejects.toThrow('paste failed')
    expect(lock.locked).toBe(false)
    expect(lock.tryAcquire()).toBe(true)
    lock.release()
  })
})
