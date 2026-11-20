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
  it('returns the app, identity and real selection range the undo guard needs', async () => {
    const exec = vi.fn(async () => ({
      stdout: 'Safari\ncom.apple.Safari\nAXTextArea\n1\n10\n0\nmain-editor\n'
    }))
    await expect(createFocusTargetProbe(exec)()).resolves.toEqual({
      kind: 'editable',
      appName: 'Safari',
      bundleId: 'com.apple.Safari',
      role: 'AXTextArea',
      identity: 'main-editor',
      selection: { location: 10, length: 0 }
    })
  })

  it('reports an unreadable selection instead of a fabricated zero', async () => {
    const exec = vi.fn(async () => ({
      stdout: 'Safari\ncom.apple.Safari\nAXTextArea\n1\nNONE\nNONE\nmain-editor\n'
    }))
    await expect(createFocusTargetProbe(exec)()).resolves.toMatchObject({
      kind: 'editable',
      selection: null
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
      identity: '',
      selection: null
    })
  })
})
