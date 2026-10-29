import React from 'react'
import { acceleratorDisplayParts } from '../../core/hotkey/accelerator'
import type { SettingState, SettingsRows } from '../../core/preferences/view'
import { THEME_LABEL, THEME_PREFERENCES } from '../../core/theme/theme'
import type { PreferencesView, ThemePreference } from '../../shared/ipc'

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
  onClose: () => void
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
  onClose
}: SettingsPanelProps): React.JSX.Element {
  return (
    <section className="card settings" id="settings-panel" aria-label="设置">
      <div className="settings-head">
        <h2>设置</h2>
        <button type="button" className="settings-close" onClick={onClose}>
          完成
        </button>
      </div>

      {error ? <p className="settings-detail error">{error}</p> : null}
      {!preferences || !rows ? (
        <p className="settings-detail">正在读取设置…</p>
      ) : (
        <div className="settings-body">
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
        </div>
      )}
    </section>
  )
}
