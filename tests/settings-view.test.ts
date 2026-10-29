import { describe, expect, it } from 'vitest'
import { DEFAULT_ACCELERATOR } from '../src/core/hotkey/accelerator'
import {
  buildSettingsRows,
  describeHotkey,
  describeProvider,
  describeTheme,
  describeVocabulary,
  validateHotkeyDraft
} from '../src/core/preferences/view'
import type { PreferencesView, VocabularySummary } from '../src/shared/ipc'

const VOCABULARY_DEFAULT: VocabularySummary = {
  path: '/tmp/userData/vocabulary.json',
  state: 'default',
  replaceCount: 0,
  protectCount: 0
}

const PREFERENCES: PreferencesView = {
  theme: 'system',
  hotkey: DEFAULT_ACCELERATOR,
  vocabulary: VOCABULARY_DEFAULT,
  provider: {
    id: 'qwen3',
    label: 'Qwen3-ASR 0.6B（本地）',
    selectable: false,
    reason: '选择模型需要先合并第二 provider 的支持。'
  }
}

describe('theme state', () => {
  it('labels the stored default as default, not as a user choice', () => {
    expect(describeTheme('system')).toMatchObject({ status: 'default', statusLabel: '默认' })
  })

  it('labels a pinned light or dark choice as an override', () => {
    expect(describeTheme('light')).toMatchObject({ status: 'override', statusLabel: '已修改' })
    expect(describeTheme('dark')).toMatchObject({ status: 'override', statusLabel: '已修改' })
  })
})

describe('hotkey state', () => {
  it('labels the built-in accelerator as default', () => {
    expect(describeHotkey(DEFAULT_ACCELERATOR)).toMatchObject({
      status: 'default',
      statusLabel: '默认'
    })
  })

  it('labels a different live accelerator as an override', () => {
    expect(describeHotkey('Command+Shift+K')).toMatchObject({
      status: 'override',
      statusLabel: '已修改'
    })
  })

  it('labels a missing hotkey as unavailable with the reason', () => {
    expect(describeHotkey('')).toMatchObject({
      status: 'unavailable',
      statusLabel: '不可用',
      detail: '系统没有接受任何全局快捷键。'
    })
    expect(describeHotkey('', '两个候选快捷键都被占用。')).toMatchObject({
      status: 'unavailable',
      detail: '两个候选快捷键都被占用。'
    })
  })

  it('surfaces a refused binding instead of claiming the fallback is the choice', () => {
    const state = describeHotkey(DEFAULT_ACCELERATOR, 'Command+Shift+K 被占用，已回退。')
    expect(state).toMatchObject({
      status: 'unavailable',
      statusLabel: '不可用',
      detail: 'Command+Shift+K 被占用，已回退。'
    })
  })
})

describe('vocabulary state', () => {
  it('labels a missing file as default', () => {
    expect(describeVocabulary(VOCABULARY_DEFAULT)).toMatchObject({
      status: 'default',
      statusLabel: '默认'
    })
  })

  it('labels a readable file as an override and counts its entries', () => {
    const state = describeVocabulary({
      ...VOCABULARY_DEFAULT,
      state: 'loaded',
      replaceCount: 3,
      protectCount: 2
    })
    expect(state.status).toBe('override')
    expect(state.detail).toContain('3 条替换')
    expect(state.detail).toContain('2 个保护词')
  })

  it('labels an unreadable file as unavailable with its reason', () => {
    const state = describeVocabulary({
      ...VOCABULARY_DEFAULT,
      state: 'unreadable',
      message: '词汇表文件不是有效的 JSON。'
    })
    expect(state).toMatchObject({ status: 'unavailable', detail: '词汇表文件不是有效的 JSON。' })
  })
})

describe('provider state', () => {
  it('reports an unavailable provider with the missing dependency and current value', () => {
    const state = describeProvider(PREFERENCES.provider)
    expect(state.status).toBe('unavailable')
    expect(state.detail).toContain('Qwen3-ASR 0.6B（本地）')
    expect(state.detail).toContain('选择模型需要先合并第二 provider 的支持。')
  })
})

describe('settings rows', () => {
  it('composes every row from the one preferences view', () => {
    const rows = buildSettingsRows({
      ...PREFERENCES,
      theme: 'dark',
      hotkey: 'Command+Shift+K',
      hotkeyMessage: 'Command+Shift+K 被占用，已回退。'
    })
    expect(Object.keys(rows)).toEqual(['theme', 'hotkey', 'vocabulary', 'provider'])
    expect(rows.theme.status).toBe('override')
    expect(rows.hotkey.status).toBe('unavailable')
    expect(rows.vocabulary.status).toBe('default')
    expect(rows.provider.status).toBe('unavailable')
  })
})

describe('hotkey draft validation', () => {
  it('rejects an invalid binding and keeps apply unavailable', () => {
    const state = validateHotkeyDraft('Space', DEFAULT_ACCELERATOR)
    expect(state.ok).toBe(false)
    expect(state.dirty).toBe(false)
    expect(state.message).toContain('修饰键')
  })

  it('treats the live binding as not dirty', () => {
    expect(validateHotkeyDraft(DEFAULT_ACCELERATOR, DEFAULT_ACCELERATOR)).toMatchObject({
      ok: true,
      dirty: false
    })
  })

  it('canonicalizes a changed binding and marks it dirty', () => {
    expect(validateHotkeyDraft('cmd+shift+k', DEFAULT_ACCELERATOR)).toMatchObject({
      ok: true,
      accelerator: 'Command+Shift+K',
      dirty: true
    })
  })
})
