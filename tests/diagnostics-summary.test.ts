import { describe, expect, it } from 'vitest'
import { redactDiagnosticText } from '../src/core/diagnostics/redact'
import { buildDiagnosticsSummary } from '../src/core/diagnostics/summary'
import type { PreferencesView } from '../src/shared/ipc'

const HOME = '/Users/alice'
const USER_DATA = `${HOME}/Library/Application Support/JustSpeak`

const PREFERENCES: PreferencesView = {
  theme: 'dark',
  hotkey: 'Command+Shift+K',
  vocabulary: {
    path: `${USER_DATA}/vocabulary.json`,
    state: 'loaded',
    replaceCount: 3,
    protectCount: 2
  },
  provider: {
    id: 'qwen3',
    label: 'Qwen3-ASR 0.6B（本地）',
    selectable: true,
    reason: `模型位于 ${HOME}/models`
  },
  llm: {
    backend: 'endpoint',
    endpoint: {
      baseUrl: 'https://api.example.com/v1',
      model: 'qwen2.5:1.5b',
      hasKey: true
    },
    local: {
      runtimeReady: true,
      modelReady: false,
      modelName: 'Qwen2.5-1.5B-Instruct',
      modelPath: `${USER_DATA}/models/llm/model.gguf`,
      state: 'failed',
      error: `本地运行时缺失：${USER_DATA}/resources/llm/llama-server`
    }
  },
  updateAutoCheck: false
}

describe('diagnostic redaction', () => {
  it('replaces userData before home so no partial user path remains', () => {
    const text = `${USER_DATA}/models/llm/model.gguf and ${HOME}/notes.txt`
    expect(redactDiagnosticText(text, { homeDir: HOME, userDataDir: USER_DATA })).toBe(
      '<userData>/models/llm/model.gguf and <home>/notes.txt'
    )
  })

  it('masks bearer tokens', () => {
    expect(redactDiagnosticText('authorization: Bearer sk-secret-123', {})).toBe(
      'authorization: Bearer <redacted>'
    )
  })

  it('leaves ordinary text untouched', () => {
    expect(redactDiagnosticText('provider ready', { homeDir: HOME })).toBe('provider ready')
  })
})

describe('diagnostics summary', () => {
  it('keeps only secret-free fields', () => {
    const summary = buildDiagnosticsSummary({
      generatedAt: '2026-11-05T00:00:00.000Z',
      app: {
        name: 'JustSpeak',
        version: '0.1.0',
        electron: '45',
        chrome: '1',
        node: '24',
        platform: 'darwin',
        arch: 'arm64',
        locale: 'zh-CN'
      },
      preferences: PREFERENCES,
      permissions: { accessibility: true, microphone: 'granted' },
      historyEntries: 12,
      redaction: { homeDir: HOME, userDataDir: USER_DATA }
    })

    const json = JSON.stringify(summary)
    expect(json).not.toContain('https://api.example.com')
    expect(json).not.toContain(USER_DATA)
    expect(json).not.toContain(HOME)
    expect(json).not.toContain('Command+Shift+K')
    expect(json).not.toContain('model.gguf')
    expect(json).not.toContain('api key')
    expect(summary.preferences.llm.endpoint).toEqual({
      configured: true,
      modelConfigured: true,
      hasKey: true
    })
    expect(summary.preferences.hotkeyConfigured).toBe(true)
    expect(summary.preferences.llm.local.error).toBe(
      '本地运行时缺失：<userData>/resources/llm/llama-server'
    )
    expect(summary.preferences.provider.reason).toBe('模型位于 <home>/models')
    expect(summary.history.entries).toBe(12)
  })

  it('reports an incomplete endpoint as not configured', () => {
    const summary = buildDiagnosticsSummary({
      generatedAt: '2026-11-05T00:00:00.000Z',
      app: {
        name: 'JustSpeak',
        version: '0.1.0',
        electron: '45',
        chrome: '1',
        node: '24',
        platform: 'darwin',
        arch: 'arm64',
        locale: 'zh-CN'
      },
      preferences: {
        ...PREFERENCES,
        llm: {
          ...PREFERENCES.llm,
          backend: 'off',
          endpoint: { baseUrl: '', model: '', hasKey: false }
        }
      },
      permissions: { accessibility: false, microphone: 'denied' },
      historyEntries: 0
    })
    expect(summary.preferences.llm.endpoint).toEqual({
      configured: false,
      modelConfigured: false,
      hasKey: false
    })
    expect(summary.permissions).toEqual({ accessibility: false, microphone: 'denied' })
  })
})
