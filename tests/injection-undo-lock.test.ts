import { describe, expect, it } from 'vitest'
import { UndoLock } from '../src/core/injection/undo-lock'

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
})
