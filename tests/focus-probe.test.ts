import { describe, expect, it, vi } from 'vitest'
import { createFocusProbe, createFocusTargetProbe } from '../src/main/focus-probe'

describe('focus probe adapter', () => {
  it('parses the Accessibility line into an editable decision', async () => {
    const exec = vi.fn(async () => ({ stdout: 'AXTextArea|1\n' }))
    await expect(createFocusProbe(exec)()).resolves.toBe('editable')
    expect(exec).toHaveBeenCalledWith('osascript', ['-e', expect.any(String)], {
      timeout: 10_000
    })
  })

  it('reports a non-editable element without treating it as a failure', async () => {
    const exec = vi.fn(async () => ({ stdout: 'AXGroup|1' }))
    await expect(createFocusProbe(exec)()).resolves.toBe('non-editable')
  })

  it('falls back to unknown when the probe process fails', async () => {
    const exec = vi.fn(async () => {
      throw new Error('Not authorized to send Apple events')
    })
    await expect(createFocusProbe(exec)()).resolves.toBe('unknown')
  })

  it('falls back to unknown when the script itself cannot read the element', async () => {
    const exec = vi.fn(async () => ({ stdout: 'UNKNOWN\n' }))
    await expect(createFocusProbe(exec)()).resolves.toBe('unknown')
  })
})

describe('extended focus target probe', () => {
  it('returns the app and focused-element identity the undo guard needs', async () => {
    const exec = vi.fn(async () => ({
      stdout: 'Safari\ncom.apple.Safari\nAXTextArea\n1\nmain-editor\n'
    }))
    await expect(createFocusTargetProbe(exec)()).resolves.toEqual({
      kind: 'editable',
      appName: 'Safari',
      bundleId: 'com.apple.Safari',
      role: 'AXTextArea',
      identity: 'main-editor'
    })
  })

  it('returns an unknown target instead of guessing when the probe fails', async () => {
    const exec = vi.fn(async () => {
      throw new Error('Not authorized to send Apple events')
    })
    await expect(createFocusTargetProbe(exec)()).resolves.toMatchObject({
      kind: 'unknown',
      appName: null,
      role: null,
      identity: ''
    })
  })
})
