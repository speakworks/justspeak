import { describe, expect, it } from 'vitest'
import { isTrustedSender } from '../src/main/ipc-sender'

describe('IPC sender allowlist', () => {
  it('accepts only the app main-window webContents id', () => {
    expect(isTrustedSender(7, 7)).toBe(true)
  })

  it('rejects foreign, missing, or uninitialized senders', () => {
    expect(isTrustedSender(8, 7)).toBe(false)
    expect(isTrustedSender(undefined, 7)).toBe(false)
    expect(isTrustedSender(7, null)).toBe(false)
    expect(isTrustedSender(7, undefined)).toBe(false)
  })
})
