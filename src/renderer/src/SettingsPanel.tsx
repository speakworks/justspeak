import React, { useEffect, useState } from 'react'
import { acceleratorDisplayParts } from '../../core/hotkey/accelerator'
import type { SettingState, SettingsRows } from '../../core/preferences/view'
import { THEME_LABEL, THEME_PREFERENCES } from '../../core/theme/theme'
import type { LlmBackend, PreferencesView, ThemePreference } from '../../shared/ipc'

export interface SettingsPanelProps {
  preferences: PreferencesView | null
  rows: SettingsRows | null
  error?: string
  hotkeyDraft: string
  hotkeyMessage?: string
  hotkeyMessageIsError: boolean
  hotkeyBusy: boolean
  canApplyHotkey: boolean
  onHotkeyDraft: (value: string) => void
  onApplyHotkey: () => void
  onTheme: (theme: ThemePreference) => void
  onReload: () => void
  onLlmBackend: (backend: LlmBackend) => void
  onLlmEndpointSave: (baseUrl: string, model: string) => void
  onLlmKeySave: (key: string) => void
  onLlmKeyClear: () => void
  onLlmDownload: () => void
  llmBusy: boolean
  llmDownloadPercent?: number
  llmFeedback?: string
  llmFeedbackIsError: boolean
  onExportDiagnostics: () => void
  diagnosticsBusy: boolean
  diagnosticsFeedback?: string
  diagnosticsFeedbackIsError: boolean
  /**
   * Which half of the surface to render: the sidebar gear shows the editable
   * settings, the 词典 destination shows the vocabulary editor. One component so
   * the editors are not duplicated. The panel renders no title of its own — the
   * page header names the destination and owns the way back.
   */
  section?: 'settings' | 'vocabulary'
}

function StatusChip({ state }: { state: SettingState }): React.JSX.Element {
  return <span className={`settings-status ${state.status}`}>{state.statusLabel}</span>
}

function CurrentHotkey({ accelerator }: { accelerator: string }): React.JSX.Element {
  const parts = accelerator ? acceleratorDisplayParts(accelerator) : []
  if (parts.length === 0) return <span className="hotkey-missing">未注册</span>
  return (
    <>
      {parts.map((part, index) => (
        <kbd key={`${part}-${index}`}>{part}</kbd>
      ))}
    </>
  )
}

/**
 * One panel for every user preference. It owns no persisted state: the values
 * come from `preferences` (main's read of disk / the live OS binding), and
 * every control writes through the single `preferences:set` surface.
 */
export function SettingsPanel({
  preferences,
  rows,
  error,
  hotkeyDraft,
  hotkeyMessage,
  hotkeyMessageIsError,
  hotkeyBusy,
  canApplyHotkey,
  onHotkeyDraft,
  onApplyHotkey,
  onTheme,
  onReload,
  onLlmBackend,
  onLlmEndpointSave,
  onLlmKeySave,
  onLlmKeyClear,
  onLlmDownload,
  llmBusy,
  llmDownloadPercent,
  llmFeedback,
  llmFeedbackIsError,
  onExportDiagnostics,
  diagnosticsBusy,
  diagnosticsFeedback,
  diagnosticsFeedbackIsError,
  section = 'settings'
}: SettingsPanelProps): React.JSX.Element {
  const vocabularyOnly = section === 'vocabulary'
  const [llmBaseUrl, setLlmBaseUrl] = useState('')
  const [llmModel, setLlmModel] = useState('')
  const [llmKey, setLlmKey] = useState('')

  useEffect(() => {
    if (!preferences) return
    setLlmBaseUrl(preferences.llm.endpoint.baseUrl)
    setLlmModel(preferences.llm.endpoint.model)
  }, [preferences?.llm.endpoint.baseUrl, preferences?.llm.endpoint.model])
  return (
    <section
      className="card settings"
      id={vocabularyOnly ? 'dictionary-panel' : 'settings-panel'}
      aria-label={vocabularyOnly ? '词典' : '设置'}
    >
      {error ? <p className="settings-detail error">{error}</p> : null}
      {!preferences || !rows ? (
        <p className="settings-detail">正在读取设置…</p>
      ) : (
        <div className="settings-body">
          {vocabularyOnly ? null : (
          <>
          <div className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">外观</span>
              <StatusChip state={rows.theme} />
            </div>
            <div className="settings-control" role="group" aria-label="外观">
              {THEME_PREFERENCES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={value === preferences.theme ? 'theme-option selected' : 'theme-option'}
                  aria-pressed={value === preferences.theme}
                  onClick={() => onTheme(value)}
                >
                  {THEME_LABEL[value]}
                </button>
              ))}
            </div>
            <p className="settings-detail">{rows.theme.detail}</p>
          </div>

          <div className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">快捷键</span>
              <StatusChip state={rows.hotkey} />
            </div>
            <div className="settings-control">
              <label className="settings-visually-hidden" htmlFor="settings-hotkey">
                全局快捷键
              </label>
              <input
                id="settings-hotkey"
                className={
                  hotkeyMessageIsError ? 'hotkey-input invalid' : 'hotkey-input settings-hotkey'
                }
                value={hotkeyDraft}
                onChange={(event) => onHotkeyDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onApplyHotkey()
                }}
                aria-invalid={hotkeyMessageIsError ? true : undefined}
                aria-describedby={hotkeyMessage ? 'settings-hotkey-message' : 'settings-hotkey-status'}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                className="hotkey-apply"
                onClick={onApplyHotkey}
                disabled={hotkeyBusy || !canApplyHotkey}
              >
                应用
              </button>
              <span id="settings-hotkey-status" className="hotkey-status">
                当前
                <CurrentHotkey accelerator={preferences.hotkey} />
              </span>
            </div>
            {hotkeyMessage ? (
              <p
                id="settings-hotkey-message"
                className={hotkeyMessageIsError ? 'hotkey-message error' : 'hotkey-message'}
              >
                {hotkeyMessage}
              </p>
            ) : (
              <p className="settings-detail">{rows.hotkey.detail}</p>
            )}
          </div>
          </>
          )}

          {vocabularyOnly ? (
          <div className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">词汇表</span>
              <StatusChip state={rows.vocabulary} />
            </div>
            <div className="settings-control">
              <code className="settings-path" title={preferences.vocabulary.path}>
                {preferences.vocabulary.path}
              </code>
              <button type="button" className="hotkey-apply" onClick={onReload}>
                重新加载
              </button>
            </div>
            <p
              className={
                preferences.vocabulary.state === 'unreadable'
                  ? 'settings-detail error'
                  : 'settings-detail'
              }
            >
              {rows.vocabulary.detail}
            </p>
          </div>

          ) : null}
          {vocabularyOnly ? null : (
          <>
          <div className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">模型</span>
              <StatusChip state={rows.provider} />
            </div>
            <div className="settings-control">
              <select
                className="settings-select"
                value={preferences.provider.id}
                disabled
                aria-describedby="settings-provider-reason"
              >
                <option value={preferences.provider.id}>{preferences.provider.label}</option>
              </select>
            </div>
            <p className="settings-detail" id="settings-provider-reason">
              {rows.provider.detail}
            </p>
          </div>

          <div className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">智能清理</span>
              <StatusChip state={rows.llm} />
            </div>
            <div className="settings-control">
              <select
                className="settings-select"
                aria-label="智能清理后端"
                value={preferences.llm.backend}
                disabled={llmBusy}
                onChange={(event) => onLlmBackend(event.target.value as LlmBackend)}
              >
                <option value="off">关闭</option>
                <option value="local">本地模型</option>
                <option value="endpoint">自定义端点</option>
              </select>
            </div>
            <p className="settings-detail">{rows.llm.detail}</p>

            {preferences.llm.backend === 'local' ? (
              <div className="settings-control">
                <button
                  type="button"
                  className="hotkey-apply"
                  onClick={onLlmDownload}
                  disabled={llmBusy || preferences.llm.local.modelReady}
                >
                  {preferences.llm.local.modelReady
                    ? '本地模型已就绪'
                    : llmDownloadPercent !== undefined
                      ? `下载中 ${llmDownloadPercent}%`
                      : '下载本地模型（约 1.1 GB）'}
                </button>
              </div>
            ) : null}

            {preferences.llm.backend === 'endpoint' ? (
              <>
                <div className="settings-control">
                  <input
                    className="hotkey-input"
                    aria-label="智能清理服务地址"
                    placeholder="https://… 或 http://127.0.0.1:11434"
                    value={llmBaseUrl}
                    onChange={(event) => setLlmBaseUrl(event.target.value)}
                  />
                  <input
                    className="hotkey-input"
                    aria-label="智能清理模型名"
                    placeholder="模型名，例如 qwen2.5:1.5b"
                    value={llmModel}
                    onChange={(event) => setLlmModel(event.target.value)}
                  />
                  <button
                    type="button"
                    className="hotkey-apply"
                    onClick={() => onLlmEndpointSave(llmBaseUrl, llmModel)}
                    disabled={llmBusy}
                  >
                    保存端点
                  </button>
                </div>
                <div className="settings-control">
                  <input
                    className="hotkey-input"
                    type="password"
                    aria-label="智能清理 API Key"
                    placeholder={
                      preferences.llm.endpoint.hasKey
                        ? '已保存（留空不修改）'
                        : 'API Key（本地端点可留空）'
                    }
                    value={llmKey}
                    onChange={(event) => setLlmKey(event.target.value)}
                  />
                  <button
                    type="button"
                    className="hotkey-apply"
                    onClick={() => {
                      onLlmKeySave(llmKey)
                      setLlmKey('')
                    }}
                    disabled={llmBusy || llmKey.trim().length === 0}
                  >
                    保存 Key
                  </button>
                  {preferences.llm.endpoint.hasKey ? (
                    <button type="button" className="quiet-button" onClick={onLlmKeyClear}>
                      清除
                    </button>
                  ) : null}
                </div>
                <p className="settings-detail">
                  开启后转写文本会发送到你配置的服务；本机端点不出设备。
                </p>
              </>
            ) : null}

            {llmFeedback ? (
              <p
                className={
                  llmFeedbackIsError ? 'settings-detail error' : 'settings-detail'
                }
              >
                {llmFeedback}
              </p>
            ) : null}
          </div>

          <div className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">诊断</span>
            </div>
            <p className="settings-detail">
              导出本机诊断包：版本、权限、运行时状态、最近日志和崩溃转储。不会上传；摘要与日志不含转写、录音、词汇表或 API Key。崩溃转储可能含进程内存，分享前请检查。
            </p>
            <div className="settings-control">
              <button
                type="button"
                className="hotkey-apply"
                onClick={onExportDiagnostics}
                disabled={diagnosticsBusy}
              >
                {diagnosticsBusy ? '正在导出…' : '导出诊断'}
              </button>
            </div>
            {diagnosticsFeedback ? (
              <p
                className={
                  diagnosticsFeedbackIsError ? 'settings-detail error' : 'settings-detail'
                }
              >
                {diagnosticsFeedback}
              </p>
            ) : null}
          </div>
          </>
          )}
        </div>
      )}
    </section>
  )
}
