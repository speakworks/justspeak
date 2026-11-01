import { describe, expect, it, vi } from 'vitest'
import { insertAtSelection } from '../src/core/shell/insert'
import { deliverTranscript, deliveryTarget } from '../src/core/shell/delivery'

describe('home input insertion', () => {
  it('inserts at the caret and leaves the caret after the inserted text', () => {
    const result = insertAtSelection({ value: '你好世界', start: 2, end: 2 }, '，朋友')
    expect(result.value).toBe('你好，朋友世界')
    expect(result.caret).toBe(2 + '，朋友'.length)
  })

  it('replaces the current selection', () => {
    const result = insertAtSelection({ value: 'hello world', start: 6, end: 11 }, 'there')
    expect(result.value).toBe('hello there')
    expect(result.caret).toBe(11)
  })

  it('appends when the selection is at the end', () => {
    const result = insertAtSelection({ value: 'abc', start: 3, end: 3 }, 'd')
    expect(result.value).toBe('abcd')
    expect(result.caret).toBe(4)
  })

  it('clamps an out-of-range selection instead of throwing', () => {
    const result = insertAtSelection({ value: 'abc', start: 99, end: 120 }, 'x')
    expect(result.value).toBe('abcx')
    expect(result.caret).toBe(4)
  })

  it('inserts nothing when the text is empty', () => {
    const result = insertAtSelection({ value: 'abc', start: 1, end: 1 }, '')
    expect(result.value).toBe('abc')
    expect(result.caret).toBe(1)
  })
})

describe('delivery target', () => {
  it('inserts into the app input when its own window has focus', () => {
    expect(deliveryTarget({ appFocused: true, focus: 'editable' })).toBe('insert')
    expect(deliveryTarget({ appFocused: true, focus: 'unknown' })).toBe('insert')
  })

  it('pastes into an editable frontmost element', () => {
    expect(deliveryTarget({ appFocused: false, focus: 'editable' })).toBe('paste')
  })

  it('shows the panel for a non-editable or unknown element', () => {
    expect(deliveryTarget({ appFocused: false, focus: 'non-editable' })).toBe('panel')
    expect(deliveryTarget({ appFocused: false, focus: 'unknown' })).toBe('panel')
  })
})

describe('delivering a transcript', () => {
  it('inserts once and never pastes while the app window is focused', async () => {
    const insert = vi.fn()
    const paste = vi.fn(async () => {})
    const probeFocus = vi.fn(async () => 'editable' as const)
    const showPanel = vi.fn()
    const target = await deliverTranscript('你好', {
      appFocused: () => true,
      probeFocus,
      insert,
      paste,
      showPanel
    })
    expect(target).toBe('insert')
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith('你好')
    expect(paste).not.toHaveBeenCalled()
    expect(probeFocus).not.toHaveBeenCalled()
    expect(showPanel).not.toHaveBeenCalled()
  })

  it('pastes once into an editable frontmost element', async () => {
    const insert = vi.fn()
    const paste = vi.fn(async () => {})
    const showPanel = vi.fn()
    const target = await deliverTranscript('你好', {
      appFocused: () => false,
      probeFocus: async () => 'editable',
      insert,
      paste,
      showPanel
    })
    expect(target).toBe('paste')
    expect(paste).toHaveBeenCalledTimes(1)
    expect(paste).toHaveBeenCalledWith('你好')
    expect(insert).not.toHaveBeenCalled()
    expect(showPanel).not.toHaveBeenCalled()
  })

  it('shows the panel and never pastes when the element is not editable', async () => {
    const insert = vi.fn()
    const paste = vi.fn(async () => {})
    const showPanel = vi.fn()
    const target = await deliverTranscript('你好', {
      appFocused: () => false,
      probeFocus: async () => 'non-editable',
      insert,
      paste,
      showPanel
    })
    expect(target).toBe('panel')
    expect(showPanel).toHaveBeenCalledWith('你好')
    expect(paste).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('shows the panel when the focus probe fails', async () => {
    const paste = vi.fn(async () => {})
    const showPanel = vi.fn()
    const target = await deliverTranscript('你好', {
      appFocused: () => false,
      probeFocus: async () => {
        throw new Error('accessibility unavailable')
      },
      insert: vi.fn(),
      paste,
      showPanel
    })
    expect(target).toBe('panel')
    expect(showPanel).toHaveBeenCalledWith('你好')
    expect(paste).not.toHaveBeenCalled()
  })

  it('surfaces a paste failure instead of silently dropping the text', async () => {
    const insert = vi.fn()
    const paste = vi.fn(async () => {
      throw new Error('粘贴失败')
    })
    await expect(
      deliverTranscript('你好', {
        appFocused: () => false,
        probeFocus: async () => 'editable',
        insert,
        paste,
        showPanel: vi.fn()
      })
    ).rejects.toThrow('粘贴失败')
    expect(insert).not.toHaveBeenCalled()
  })
})
