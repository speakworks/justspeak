import { describe, expect, it, vi } from 'vitest'
import {
  PASTE_PERMISSION_MESSAGE,
  pasteTranscript,
  type ClipboardSnapshot,
  type PastePorts
} from '../src/core/injection/paste'

function makePorts(initial: ClipboardSnapshot = { items: [{ type: 'old' }], text: 'old' }) {
  let clipboard = initial.text
  let items = initial.items
  const restored: ClipboardSnapshot[] = []
  const warnings: string[] = []

  const ports: PastePorts = {
    snapshot: async () => ({ items: [...items], text: clipboard }),
    writeText: async (text) => {
      clipboard = text
    },
    readText: async () => clipboard,
    restore: async (snapshot) => {
      restored.push(snapshot)
      items = snapshot.items
      clipboard = snapshot.text
    },
    clear: vi.fn(async () => {
      items = []
      clipboard = ''
    }),
    pressPaste: vi.fn(async () => {}),
    delay: async () => {},
    warn: (message) => warnings.push(message)
  }
  return {
    ports,
    restored,
    warnings,
    setClipboard: (text: string) => {
      clipboard = text
    },
    clipboard: () => clipboard
  }
}

describe('clipboard paste policy', () => {
  it('restores the previous clipboard after a successful paste', async () => {
    const harness = makePorts()
    await pasteTranscript('你好', harness.ports)
    expect(harness.restored).toHaveLength(1)
    expect(harness.restored[0]?.text).toBe('old')
    expect(harness.clipboard()).toBe('old')
  })

  it('does not overwrite a user copy made during the paste', async () => {
    const harness = makePorts()
    harness.ports.readText = async () => 'user-copy'
    await pasteTranscript('你好', harness.ports)
    expect(harness.restored).toHaveLength(0)
    expect(harness.clipboard()).toBe('你好')
  })

  it('keeps the transcript and reports the permission message when paste fails', async () => {
    const harness = makePorts()
    harness.ports.pressPaste = async () => {
      throw new Error('not allowed')
    }
    await expect(pasteTranscript('你好', harness.ports)).rejects.toThrow(PASTE_PERMISSION_MESSAGE)
    expect(harness.restored).toHaveLength(0)
    expect(harness.clipboard()).toBe('你好')
  })

  it('clears an originally empty clipboard', async () => {
    const harness = makePorts({ items: [], text: '' })
    await pasteTranscript('你好', harness.ports)
    expect(harness.ports.clear).toHaveBeenCalledTimes(1)
    expect(harness.clipboard()).toBe('')
  })

  it('falls back to previous plain text when full restore fails', async () => {
    const harness = makePorts()
    harness.ports.restore = async () => {
      throw new Error('restore failed')
    }
    await pasteTranscript('你好', harness.ports)
    expect(harness.warnings).toContain('full clipboard restore failed; trying text fallback')
    expect(harness.clipboard()).toBe('old')
    expect(harness.warnings.some((warning) => warning.includes('no text fallback'))).toBe(false)
  })

  it('restores non-text items and warns when text fallback is unavailable', async () => {
    const harness = makePorts({ items: [{ type: 'public.png' }], text: '' })
    await pasteTranscript('你好', harness.ports)
    expect(harness.restored).toHaveLength(1)
    expect(harness.restored[0]?.items).toHaveLength(1)
  })
})
