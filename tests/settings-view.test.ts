import { describe, expect, it } from 'vitest'
import { DEFAULT_ACCELERATOR } from '../src/core/hotkey/accelerator'
import { QWEN3_CAPABILITIES } from '../src/core/asr/qwen3-provider'
import { SENSEVOICE_CAPABILITIES } from '../src/core/asr/sensevoice-provider'
import {
  buildSettingsRows,
  describeAutostart,
  describeHotkey,
  describeLlm,
  describeProvider,
  resolveProviderSupportsTerms,
  summarizeProvider,
  PROVIDER_SETTINGS_HINT,
  PROVIDER_NOT_READY_REASON,
  PROVIDER_FAKE_REASON,
  describeTheme,
  describeUndoWindow,
  describeStarterLoadOverflow,
  describeVocabulary
} from '../src/core/preferences/view'
import type { PreferencesView, VocabularySummary } from '../src/shared/ipc'

const VOCABULARY_DEFAULT: VocabularySummary = {
  path: '/tmp/userData/vocabulary.json',
  state: 'default',
  termCount: 0,
  replaceCount: 0,
  protectCount: 0,
  droppedTermCount: 0,
  droppedByCapCount: 0,
  providerSupportsTerms: true,
  terms: [],
  replace: [],
  protect: [],
  starterTerms: []
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
  },
  llm: {
    backend: 'off',
    endpoint: { baseUrl: '', model: '', hasKey: false },
    local: {
      runtimeReady: false,
      modelReady: false,
      modelName: '',
      modelPath: '',
      state: 'idle'
    }
  },
  loginItem: { available: true, openAtLogin: true, status: 'enabled' },
  updateAutoCheck: false,
  undoWindowMinutes: 5
}

describe('llm state', () => {
  it('labels off as the default', () => {
    expect(describeLlm(PREFERENCES.llm)).toMatchObject({ status: 'default', statusLabel: '默认' })
  })

  it('labels a ready local model as an override', () => {
    expect(
      describeLlm({
        backend: 'local',
        endpoint: { baseUrl: '', model: '', hasKey: false },
        local: {
          runtimeReady: true,
          modelReady: true,
          modelName: 'Qwen',
          modelPath: '/m',
          state: 'ready'
        }
      })
    ).toMatchObject({ status: 'override' })
  })

  it('does not claim ready when the local sidecar failed', () => {
    expect(
      describeLlm({
        backend: 'local',
        endpoint: { baseUrl: '', model: '', hasKey: false },
        local: {
          runtimeReady: true,
          modelReady: true,
          modelName: 'Qwen',
          modelPath: '/m',
          state: 'failed',
          error: 'llama-server exited during startup'
        }
      })
    ).toMatchObject({ status: 'unavailable' })
  })

  it('labels an incomplete endpoint as unavailable', () => {
    expect(
      describeLlm({
        backend: 'endpoint',
        endpoint: { baseUrl: '', model: '', hasKey: false },
        local: {
          runtimeReady: false,
          modelReady: false,
          modelName: '',
          modelPath: '',
          state: 'idle'
        }
      })
    ).toMatchObject({ status: 'unavailable' })
  })
})

describe('theme state', () => {
  it('labels the stored default as default, not as a user choice', () => {
    expect(describeTheme('system')).toMatchObject({ status: 'default', statusLabel: '默认' })
  })

  it('labels a pinned light or dark choice as an override', () => {
    expect(describeTheme('light')).toMatchObject({ status: 'override', statusLabel: '已修改' })
    expect(describeTheme('dark')).toMatchObject({ status: 'override', statusLabel: '已修改' })
  })
})

describe('autostart state', () => {
  it('labels an enabled login item as the built-in default', () => {
    expect(
      describeAutostart({ available: true, openAtLogin: true, status: 'enabled' })
    ).toMatchObject({
      status: 'default',
      statusLabel: '默认'
    })
  })

  it('labels a system-reported off state as an override and points at System Settings', () => {
    const state = describeAutostart({
      available: true,
      openAtLogin: false,
      status: 'not-registered'
    })
    expect(state.status).toBe('override')
    expect(state.statusLabel).toBe('已修改')
    expect(state.detail).toContain('系统设置')
  })

  it('reports requires-approval as its own pending state, not as a refusal', () => {
    const state = describeAutostart({
      available: true,
      openAtLogin: false,
      status: 'requires-approval'
    })
    expect(state.status).toBe('pending')
    expect(state.statusLabel).toBe('待允许')
    expect(state.detail).toContain('允许开机自启')
  })

  it('labels an unreadable login item as unavailable with the reason', () => {
    const state = describeAutostart({
      available: false,
      openAtLogin: false,
      status: 'not-registered',
      message: '无法读取登录项状态：boom'
    })
    expect(state).toMatchObject({
      status: 'unavailable',
      statusLabel: '不可用',
      detail: '无法读取登录项状态：boom'
    })
  })

  it('labels an available but unapplied change as pending, not unavailable', () => {
    const state = describeAutostart({
      available: true,
      openAtLogin: false,
      status: 'not-registered',
      message: '系统没有接受开机自启设置。'
    })
    expect(state).toMatchObject({
      status: 'pending',
      statusLabel: '未生效',
      detail: '系统没有接受开机自启设置。'
    })
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

  it('labels a readable file as an override and counts terms, replacements, and protected terms', () => {
    const state = describeVocabulary({
      ...VOCABULARY_DEFAULT,
      state: 'loaded',
      termCount: 3,
      replaceCount: 2,
      protectCount: 1
    })
    expect(state.status).toBe('override')
    expect(state.detail).toContain('术语 3 条')
    expect(state.detail).toContain('替换 2 条')
    expect(state.detail).toContain('保护 1 条')
  })

  it('explains comma-dropped terms by count without naming them', () => {
    const state = describeVocabulary({
      ...VOCABULARY_DEFAULT,
      state: 'loaded',
      termCount: 2,
      droppedTermCount: 2
    })
    expect(state.detail).toContain('2 条术语因含英文逗号被忽略')
  })

  it('names the over-cap tail without changing the comma wording', () => {
    const state = describeVocabulary({
      ...VOCABULARY_DEFAULT,
      state: 'loaded',
      termCount: 32,
      droppedTermCount: 1,
      droppedByCapCount: 3
    })
    expect(state.detail).toContain('3 条超出 32 条上限未写入')
    expect(state.detail).toContain('1 条术语因含英文逗号被忽略')
  })

  it('states that terms are not applied when the provider lacks the capability', () => {
    const state = describeVocabulary({
      ...VOCABULARY_DEFAULT,
      state: 'loaded',
      termCount: 2,
      providerSupportsTerms: false
    })
    expect(state.detail).toContain('不支持')
    expect(state.detail).toContain('术语未生效')
  })

  it('does not mention the unsupported state when no terms are configured', () => {
    const state = describeVocabulary({
      ...VOCABULARY_DEFAULT,
      state: 'loaded',
      providerSupportsTerms: false
    })
    expect(state.detail).not.toContain('术语未生效')
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

describe('starter load overflow copy', () => {
  it('stays silent when nothing overflowed', () => {
    expect(describeStarterLoadOverflow(0)).toBeUndefined()
    expect(describeStarterLoadOverflow(-1)).toBeUndefined()
  })

  it('states the count and the remedy when the cap blocked starter terms', () => {
    expect(describeStarterLoadOverflow(3)).toBe(
      '3 条起始词因超出 32 条上限未写入，请先删除部分词条。'
    )
  })
})

describe('provider state', () => {
  it('reports an unavailable provider with the missing dependency and current value', () => {
    const state = describeProvider(PREFERENCES.provider)
    expect(state.status).toBe('unavailable')
    expect(state.detail).toContain('Qwen3-ASR 0.6B（本地）')
    expect(state.detail).toContain('选择模型需要先合并第二 provider 的支持。')
  })

  it('does not call a switchable provider unavailable, and says where to switch it', () => {
    const state = describeProvider(
      summarizeProvider({ mode: 'qwen3', live: true, label: 'Qwen3-ASR 0.6B' })
    )
    expect(state.status).toBe('default')
    expect(state.statusLabel).toBe('默认')
    expect(state.detail).toBe('当前：Qwen3-ASR 0.6B。在上方下拉中选择模型。')
  })
})

describe('undo window state', () => {
  it('labels five minutes as the default and names the window', () => {
    expect(describeUndoWindow(5)).toMatchObject({
      status: 'default',
      statusLabel: '默认',
      detail: expect.stringContaining('5 分钟')
    })
  })

  it('labels any other accepted window as an override', () => {
    expect(describeUndoWindow(10)).toMatchObject({
      status: 'override',
      statusLabel: '已修改',
      detail: expect.stringContaining('10 分钟')
    })
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
    expect(Object.keys(rows)).toEqual([
      'theme',
      'hotkey',
      'autostart',
      'undoWindow',
      'vocabulary',
      'provider',
      'llm'
    ])
    expect(rows.theme.status).toBe('override')
    expect(rows.hotkey.status).toBe('unavailable')
    expect(rows.autostart.status).toBe('default')
    expect(rows.undoWindow.status).toBe('default')
    expect(rows.vocabulary.status).toBe('default')
    expect(rows.provider.status).toBe('unavailable')
    expect(rows.llm.status).toBe('default')
  })
})

describe('provider term capability', () => {
  it('falls back to the selected provider capability when no provider is live', () => {
    expect(resolveProviderSupportsTerms(undefined, QWEN3_CAPABILITIES)).toBe(true)
    expect(resolveProviderSupportsTerms(undefined, SENSEVOICE_CAPABILITIES)).toBe(false)
    // No live adapter and no selectable provider (fake, unavailable) is false.
    expect(resolveProviderSupportsTerms(undefined, undefined)).toBe(false)
    // A live adapter wins over the selected static capability.
    expect(resolveProviderSupportsTerms(QWEN3_CAPABILITIES, SENSEVOICE_CAPABILITIES)).toBe(true)
  })
})

describe('provider liveness', () => {
  it('offers the settings selector only while a provider is actually live', () => {
    expect(summarizeProvider({ mode: 'qwen3', live: true, label: 'Qwen3-ASR 0.6B' })).toEqual({
      id: 'qwen3',
      label: 'Qwen3-ASR 0.6B',
      selectable: true,
      reason: PROVIDER_SETTINGS_HINT
    })
  })

  it('reports not-ready rather than promising a switch the app cannot make', () => {
    // The mode id survives a missing model, a bad JUSTSPEAK_ASR, or an invalid
    // segmentation config, so liveness — not the id — decides the row.
    const state = describeProvider(
      summarizeProvider({ mode: 'qwen3', live: false, label: 'Qwen3-ASR 0.6B' })
    )
    expect(state.status).toBe('unavailable')
    expect(state.detail).toContain(PROVIDER_NOT_READY_REASON)
    expect(summarizeProvider({ mode: 'qwen3', live: false, label: 'Qwen3-ASR 0.6B' })).toMatchObject({
      selectable: false
    })
  })

  it('treats an unknown mode as unavailable and fake as not switchable', () => {
    expect(summarizeProvider({ mode: 'unavailable', live: false })).toMatchObject({
      id: 'unavailable',
      selectable: false,
      reason: PROVIDER_NOT_READY_REASON
    })
    const fake = describeProvider(summarizeProvider({ mode: 'fake', live: true }))
    expect(fake.detail).toContain(PROVIDER_FAKE_REASON)
    expect(fake.status).toBe('unavailable')
  })
})
