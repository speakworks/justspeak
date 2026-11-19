import React, { useEffect, useRef, useState } from 'react'
import {
  importReplacementLines,
  importTermLines,
  MAX_VOCABULARY_TERMS,
  planStarterLoad
} from '../../core/postprocess'
import {
  describeStarterLoadOverflow,
  type SettingState,
  type SettingsRows
} from '../../core/preferences/view'
import {
  SEGMENTATION_DESCRIPTIONS,
  SEGMENTATION_LABELS,
  SEGMENTATION_PREFERENCES
} from '../../core/preferences/segmentation'
import { THEME_LABEL, THEME_PREFERENCES } from '../../core/theme/theme'
import type {
  AsrProviderSelection,
  LlmBackend,
  PreferencesView,
  SegmentationPreference,
  SelectableAsrProviderId,
  ThemePreference,
  VocabularySavePayload,
  VocabularySaveResult
} from '../../shared/ipc'
import { HotkeyRecorder } from './HotkeyRecorder'
import { UpdateRow } from './UpdateRow'

export interface SettingsPanelProps {
  preferences: PreferencesView | null
  rows: SettingsRows | null
  error?: string
  hotkeyMessage?: string
  hotkeyMessageIsError: boolean
  hotkeyBusy: boolean
  hotkeyCapturing: boolean
  onHotkeyBegin: () => void
  onHotkeyCaptured: (accelerator: string) => void
  onHotkeyCancel: () => void
  onHotkeyHint: (message?: string) => void
  onTheme: (theme: ThemePreference) => void
  /** Writes 开机自动启动; the row renders the OS read-back main returns. */
  onAutostart: (enabled: boolean) => void
  autostartBusy: boolean
  /** Writes the 撤销时间窗 in whole minutes (1–60). */
  onUndoWindow: (minutes: number) => void
  /** Writes the 长句听写 choice; main applies it immediately when idle. */
  onSegmentation: (preference: SegmentationPreference) => void
  onReload: () => void
  /** Saves the three vocabulary lists; main normalises, writes, and reads back. */
  onVocabularySave: (payload: VocabularySavePayload) => Promise<VocabularySaveResult>
  onLlmBackend: (backend: LlmBackend) => void
  onLlmEndpointSave: (baseUrl: string, model: string) => void
  onLlmKeySave: (key: string) => void
  onLlmKeyClear: () => void
  onLlmDownload: () => void
  /** Live ASR selection, including the options main reports; settings owns switching. */
  asr?: AsrProviderSelection
  onProviderChange: (provider: SelectableAsrProviderId) => void
  /** True while recording or a session rebuild is in flight (main rejects a switch then). */
  providerBusy: boolean
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

/** One import outcome in the user's words; zero counts stay off the line. */
function describeImport(result: {
  entries: unknown[]
  duplicates: number
  invalidLines: number
}): string {
  const parts = [`导入 ${result.entries.length} 条`]
  if (result.duplicates > 0) parts.push(`去重 ${result.duplicates} 行`)
  if (result.invalidLines > 0) parts.push(`无效 ${result.invalidLines} 行`)
  return `${parts.join('，')}。`
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
  hotkeyMessage,
  hotkeyMessageIsError,
  hotkeyBusy,
  hotkeyCapturing,
  onHotkeyBegin,
  onHotkeyCaptured,
  onHotkeyCancel,
  onHotkeyHint,
  onTheme,
  onAutostart,
  autostartBusy,
  onUndoWindow,
  onSegmentation,
  onReload,
  onVocabularySave,
  onLlmBackend,
  onLlmEndpointSave,
  onLlmKeySave,
  onLlmKeyClear,
  onLlmDownload,
  asr,
  onProviderChange,
  providerBusy,
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
  const [undoWindowDraft, setUndoWindowDraft] = useState('')
  const [undoWindowError, setUndoWindowError] = useState<string | undefined>()

  // The vocabulary editor keeps a draft per list. Drafts survive unrelated
  // preference pushes (LLM status, hotkey events) unless the file on disk
  // actually changed, so a background refresh cannot erase typing.
  const [termDraft, setTermDraft] = useState<string[]>([])
  const [replaceDraft, setReplaceDraft] = useState<VocabularySavePayload['replace']>([])
  const [protectDraft, setProtectDraft] = useState<string[]>([])
  const [termPaste, setTermPaste] = useState('')
  const [replacePaste, setReplacePaste] = useState('')
  const [protectPaste, setProtectPaste] = useState('')
  const [termImport, setTermImport] = useState<string | undefined>()
  const [replaceImport, setReplaceImport] = useState<string | undefined>()
  const [protectImport, setProtectImport] = useState<string | undefined>()
  const [vocabularyBusy, setVocabularyBusy] = useState(false)
  const [vocabularyFeedback, setVocabularyFeedback] = useState<string | undefined>()
  const [vocabularyFeedbackError, setVocabularyFeedbackError] = useState(false)
  const syncedVocabulary = useRef('')
  const vocabularyDirty = useRef(false)

  useEffect(() => {
    if (!preferences) return
    setLlmBaseUrl(preferences.llm.endpoint.baseUrl)
    setLlmModel(preferences.llm.endpoint.model)
  }, [preferences?.llm.endpoint.baseUrl, preferences?.llm.endpoint.model])

  useEffect(() => {
    if (!preferences) return
    setUndoWindowDraft(String(preferences.undoWindowMinutes))
    setUndoWindowError(undefined)
  }, [preferences?.undoWindowMinutes])

  const vocabularySignature =
    preferences === null
      ? ''
      : JSON.stringify([
          preferences.vocabulary.terms,
          preferences.vocabulary.replace,
          preferences.vocabulary.protect
        ])

  useEffect(() => {
    if (!preferences) return
    if (vocabularySignature === syncedVocabulary.current) return
    syncedVocabulary.current = vocabularySignature
    // Unsaved typing wins over an unrelated background refresh.
    if (vocabularyDirty.current) return
    setTermDraft([...preferences.vocabulary.terms])
    setReplaceDraft(preferences.vocabulary.replace.map((entry) => ({ ...entry })))
    setProtectDraft([...preferences.vocabulary.protect])
  }, [preferences, vocabularySignature])

  const markVocabularyDirty = (): void => {
    vocabularyDirty.current = true
  }

  const importVocabularyTerms = (): void => {
    const result = importTermLines(termPaste)
    setTermDraft(result.entries)
    setTermPaste('')
    setTermImport(describeImport(result))
    markVocabularyDirty()
  }

  const importVocabularyReplacements = (): void => {
    const result = importReplacementLines(replacePaste)
    setReplaceDraft(result.entries)
    setReplacePaste('')
    setReplaceImport(describeImport(result))
    markVocabularyDirty()
  }

  const importVocabularyProtect = (): void => {
    const result = importTermLines(protectPaste)
    setProtectDraft(result.entries)
    setProtectPaste('')
    setProtectImport(describeImport(result))
    markVocabularyDirty()
  }

  const reloadVocabulary = (): void => {
    vocabularyDirty.current = false
    // Force the next view (even byte-identical) to replace the drafts.
    syncedVocabulary.current = ''
    setVocabularyFeedback(undefined)
    setTermPaste('')
    setReplacePaste('')
    setProtectPaste('')
    setTermImport(undefined)
    setReplaceImport(undefined)
    setProtectImport(undefined)
    onReload()
  }

  const persistVocabulary = async (
    lists: VocabularySavePayload,
    outcome?: { excludedByCap?: number }
  ): Promise<boolean> => {
    setVocabularyBusy(true)
    setVocabularyFeedback(undefined)
    try {
      const result = await onVocabularySave(lists)
      if (!result.ok) {
        // The draft is deliberately preserved so the user can correct it.
        setVocabularyFeedback(result.message ?? '保存词汇表失败。')
        setVocabularyFeedbackError(true)
        return false
      }
      vocabularyDirty.current = false
      setVocabularyFeedbackError(false)
      const vocabulary = result.view?.vocabulary
      // A starter load that did not fit under the cap must not read as a full
      // success: name the overflow and keep the ordinary saved copy when none.
      const overflow = describeStarterLoadOverflow(outcome?.excludedByCap ?? 0)
      setVocabularyFeedback(
        overflow ??
          (vocabulary
            ? `已保存：术语 ${vocabulary.termCount} 条 / 替换 ${vocabulary.replaceCount} 条 / 保护 ${vocabulary.protectCount} 条。`
            : '已保存。')
      )
      return true
    } catch (error) {
      setVocabularyFeedback(error instanceof Error ? error.message : String(error))
      setVocabularyFeedbackError(true)
      return false
    } finally {
      setVocabularyBusy(false)
    }
  }

  const saveVocabulary = (): Promise<boolean> =>
    persistVocabulary({
      terms: termDraft,
      replace: replaceDraft,
      protect: protectDraft
    })

  /**
   * Explicit starter load: merge missing entries into the draft, then use the
   * same save path as a manual edit. When every starter entry is already
   * present this returns without writing.
   */
  const loadStarterVocabulary = async (): Promise<void> => {
    const starter = preferences?.vocabulary.starterTerms ?? []
    if (starter.length === 0) return
    const plan = planStarterLoad(termDraft, starter, MAX_VOCABULARY_TERMS)
    if (plan.complete) {
      setVocabularyFeedbackError(false)
      setVocabularyFeedback('起始词表已全部载入。')
      return
    }
    if (plan.added === 0) {
      // complete is false with nothing appended only when the cap blocked every
      // missing entry; rewriting the same list would hide the reason.
      setVocabularyFeedbackError(false)
      setVocabularyFeedback(
        describeStarterLoadOverflow(plan.excludedByCap) ?? '没有新的起始词可载入。'
      )
      return
    }
    setTermDraft(plan.terms)
    markVocabularyDirty()
    await persistVocabulary(
      {
        terms: plan.terms,
        replace: replaceDraft,
        protect: protectDraft
      },
      { excludedByCap: plan.excludedByCap }
    )
  }

  const commitUndoWindow = (): void => {
    if (!preferences) return
    const value = Number(undoWindowDraft)
    if (Number.isInteger(value) && value >= 1 && value <= 60) {
      setUndoWindowError(undefined)
      if (value !== preferences.undoWindowMinutes) onUndoWindow(value)
      return
    }
    // An invalid intermediate value snaps back to the stored window and names
    // the accepted range, instead of silently keeping a value that never saved.
    setUndoWindowDraft(String(preferences.undoWindowMinutes))
    setUndoWindowError('撤销时间窗必须是 1 到 60 之间的整数分钟。')
  }

  const starterComplete =
    preferences !== null &&
    planStarterLoad(
      termDraft,
      preferences.vocabulary.starterTerms,
      MAX_VOCABULARY_TERMS
    ).complete

  const segmentation = preferences?.segmentation
  // A valid env override owns the displayed gear: the radio must never show a
  // stored choice the running provider did not adopt.
  const segmentationLocked = segmentation?.source === 'env'
  const selectedSegmentation = segmentation
    ? segmentationLocked
      ? segmentation.effective
      : segmentation.preference
    : undefined

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
              <HotkeyRecorder
                accelerator={preferences.hotkey}
                capturing={hotkeyCapturing}
                busy={hotkeyBusy}
                invalid={hotkeyMessageIsError}
                describedBy={
                  hotkeyMessage ? 'settings-hotkey-message' : 'settings-hotkey-status'
                }
                onBegin={onHotkeyBegin}
                onCaptured={onHotkeyCaptured}
                onCancel={onHotkeyCancel}
                onHint={onHotkeyHint}
              />
              <span id="settings-hotkey-status" className="hotkey-status" aria-live="polite">
                {hotkeyCapturing ? '按 Esc 取消' : '点击后直接按组合键'}
              </span>
              <span className="settings-live" role="status" aria-live="polite">
                {hotkeyMessage ?? ''}
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
              <span className="settings-label">开机自动启动</span>
              <StatusChip state={rows.autostart} />
            </div>
            <div className="settings-control">
              <button
                type="button"
                className={
                  preferences.loginItem.openAtLogin ? 'theme-option selected' : 'theme-option'
                }
                aria-pressed={preferences.loginItem.openAtLogin}
                disabled={autostartBusy || !preferences.loginItem.available}
                onClick={() => onAutostart(!preferences.loginItem.openAtLogin)}
              >
                {!preferences.loginItem.available
                  ? '不可用'
                  : preferences.loginItem.openAtLogin
                    ? '已开启'
                    : '已关闭'}
              </button>
            </div>
            <p className="settings-detail">{rows.autostart.detail}</p>
          </div>

          <div className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">撤销时间窗</span>
              <StatusChip state={rows.undoWindow} />
            </div>
            <div className="settings-control">
              <input
                className="hotkey-input undo-window-input"
                type="number"
                min={1}
                max={60}
                step={1}
                aria-label="撤销时间窗（分钟）"
                value={undoWindowDraft}
                onChange={(event) => setUndoWindowDraft(event.target.value)}
                onBlur={commitUndoWindow}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitUndoWindow()
                  }
                }}
              />
              <span className="settings-live">分钟</span>
            </div>
            <p className="settings-detail">{rows.undoWindow.detail}</p>
            {undoWindowError ? (
              <p className="settings-detail error" role="status" aria-live="polite">
                {undoWindowError}
              </p>
            ) : null}
          </div>

          <div className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">长句听写</span>
              <StatusChip state={rows.segmentation} />
            </div>
            <div
              className="segmentation-options"
              role="radiogroup"
              aria-label="长句听写"
            >
              {SEGMENTATION_PREFERENCES.map((value) => (
                <label
                  key={value}
                  className={
                    value === selectedSegmentation
                      ? 'segmentation-option selected'
                      : 'segmentation-option'
                  }
                >
                  <input
                    type="radio"
                    name="segmentation"
                    value={value}
                    checked={value === selectedSegmentation}
                    disabled={segmentationLocked}
                    onChange={() => onSegmentation(value)}
                  />
                  <span className="segmentation-label">{SEGMENTATION_LABELS[value]}</span>
                  <span className="segmentation-desc">
                    {SEGMENTATION_DESCRIPTIONS[value]}
                  </span>
                </label>
              ))}
            </div>
            <p className="settings-detail">{rows.segmentation.detail}</p>
          </div>
          </>
          )}

          {vocabularyOnly ? (
          <>
          <div className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">词汇表</span>
              <StatusChip state={rows.vocabulary} />
            </div>
            <div className="settings-control">
              <code className="settings-path" title={preferences.vocabulary.path}>
                {preferences.vocabulary.path}
              </code>
              <button type="button" className="hotkey-apply" onClick={reloadVocabulary}>
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
              <span className="settings-label">术语</span>
              <span className="settings-detail">{termDraft.length} 条</span>
            </div>
            <p className="settings-detail">
              解码前作为提示传给识别模型；最多 32 条生效，含英文逗号或控制字符的术语会被丢弃。
            </p>
            <div className="vocabulary-list">
              {termDraft.length === 0 ? (
                <p className="settings-detail">还没有术语。</p>
              ) : (
                termDraft.map((term, index) => (
                  <div className="vocabulary-entry" key={`term-${index}`}>
                    <input
                      className="hotkey-input vocabulary-input"
                      aria-label={`术语 ${index + 1}`}
                      value={term}
                      onChange={(event) => {
                        const next = [...termDraft]
                        next[index] = event.target.value
                        setTermDraft(next)
                        markVocabularyDirty()
                      }}
                    />
                    <button
                      type="button"
                      className="hotkey-apply"
                      onClick={() => {
                        setTermDraft(termDraft.filter((_, position) => position !== index))
                        markVocabularyDirty()
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="settings-control">
              <button
                type="button"
                className="hotkey-apply"
                onClick={() => {
                  setTermDraft([...termDraft, ''])
                  markVocabularyDirty()
                }}
              >
                添加术语
              </button>
            </div>
            <textarea
              className="hotkey-input vocabulary-paste"
              aria-label="批量粘贴术语"
              placeholder="一行一条；导入会替换当前术语列表"
              value={termPaste}
              onChange={(event) => setTermPaste(event.target.value)}
            />
            <div className="settings-control">
              <button
                type="button"
                className="hotkey-apply"
                disabled={termPaste.trim().length === 0}
                onClick={importVocabularyTerms}
              >
                导入术语
              </button>
              {termImport ? <span className="settings-detail">{termImport}</span> : null}
            </div>
            <div className="settings-control">
              <button
                type="button"
                className="hotkey-apply"
                disabled={vocabularyBusy || starterComplete}
                onClick={() => void loadStarterVocabulary()}
              >
                {starterComplete ? '已全部载入' : '载入起始词表（10 词）'}
              </button>
            </div>
            <p className="settings-detail">
              起始词表只在你点击后写入，已存在的词不会重复添加。
            </p>
            {!preferences.vocabulary.providerSupportsTerms && termDraft.length > 0 ? (
              <p className="settings-detail">
                当前 ASR 模型不支持解码期术语偏置，术语未生效。
              </p>
            ) : null}
          </div>

          <div className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">替换</span>
              <span className="settings-detail">{replaceDraft.length} 条</span>
            </div>
            <p className="settings-detail">
              转写完成后按原文精确改写；原文与替换词都不能为空。
            </p>
            <div className="vocabulary-list">
              {replaceDraft.length === 0 ? (
                <p className="settings-detail">还没有替换规则。</p>
              ) : (
                replaceDraft.map((entry, index) => (
                  <div className="vocabulary-entry vocabulary-replace" key={`replace-${index}`}>
                    <input
                      className="hotkey-input vocabulary-input"
                      aria-label={`替换原文 ${index + 1}`}
                      placeholder="原文"
                      value={entry.from}
                      onChange={(event) => {
                        const next = replaceDraft.map((item) => ({ ...item }))
                        next[index].from = event.target.value
                        setReplaceDraft(next)
                        markVocabularyDirty()
                      }}
                    />
                    <span className="settings-detail">→</span>
                    <input
                      className="hotkey-input vocabulary-input"
                      aria-label={`替换词 ${index + 1}`}
                      placeholder="替换词"
                      value={entry.to}
                      onChange={(event) => {
                        const next = replaceDraft.map((item) => ({ ...item }))
                        next[index].to = event.target.value
                        setReplaceDraft(next)
                        markVocabularyDirty()
                      }}
                    />
                    <button
                      type="button"
                      className="hotkey-apply"
                      onClick={() => {
                        setReplaceDraft(replaceDraft.filter((_, position) => position !== index))
                        markVocabularyDirty()
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="settings-control">
              <button
                type="button"
                className="hotkey-apply"
                onClick={() => {
                  setReplaceDraft([...replaceDraft, { from: '', to: '' }])
                  markVocabularyDirty()
                }}
              >
                添加替换
              </button>
            </div>
            <textarea
              className="hotkey-input vocabulary-paste"
              aria-label="批量粘贴替换"
              placeholder="一行一条，格式：原文 => 替换；导入会替换当前列表"
              value={replacePaste}
              onChange={(event) => setReplacePaste(event.target.value)}
            />
            <div className="settings-control">
              <button
                type="button"
                className="hotkey-apply"
                disabled={replacePaste.trim().length === 0}
                onClick={importVocabularyReplacements}
              >
                导入替换
              </button>
              {replaceImport ? <span className="settings-detail">{replaceImport}</span> : null}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">保护词</span>
              <span className="settings-detail">{protectDraft.length} 条</span>
            </div>
            <p className="settings-detail">这些词不会被替换或其它规则改写。</p>
            <div className="vocabulary-list">
              {protectDraft.length === 0 ? (
                <p className="settings-detail">还没有保护词。</p>
              ) : (
                protectDraft.map((word, index) => (
                  <div className="vocabulary-entry" key={`protect-${index}`}>
                    <input
                      className="hotkey-input vocabulary-input"
                      aria-label={`保护词 ${index + 1}`}
                      value={word}
                      onChange={(event) => {
                        const next = [...protectDraft]
                        next[index] = event.target.value
                        setProtectDraft(next)
                        markVocabularyDirty()
                      }}
                    />
                    <button
                      type="button"
                      className="hotkey-apply"
                      onClick={() => {
                        setProtectDraft(protectDraft.filter((_, position) => position !== index))
                        markVocabularyDirty()
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="settings-control">
              <button
                type="button"
                className="hotkey-apply"
                onClick={() => {
                  setProtectDraft([...protectDraft, ''])
                  markVocabularyDirty()
                }}
              >
                添加保护词
              </button>
            </div>
            <textarea
              className="hotkey-input vocabulary-paste"
              aria-label="批量粘贴保护词"
              placeholder="一行一条；导入会替换当前保护词列表"
              value={protectPaste}
              onChange={(event) => setProtectPaste(event.target.value)}
            />
            <div className="settings-control">
              <button
                type="button"
                className="hotkey-apply"
                disabled={protectPaste.trim().length === 0}
                onClick={importVocabularyProtect}
              >
                导入保护词
              </button>
              {protectImport ? <span className="settings-detail">{protectImport}</span> : null}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">保存</span>
            </div>
            <div className="settings-control">
              <button
                type="button"
                className="hotkey-apply"
                disabled={vocabularyBusy}
                onClick={() => void saveVocabulary()}
              >
                {vocabularyBusy ? '保存中…' : '保存词汇表'}
              </button>
            </div>
            <p
              className={
                vocabularyFeedbackError ? 'settings-detail error' : 'settings-detail'
              }
              role="status"
              aria-live="polite"
            >
              {vocabularyFeedback ?? '保存后立即用于下一次听写；三类都为空时写入空列表。'}
            </p>
          </div>
          </>
          ) : null}
          {vocabularyOnly ? null : (
          <>
          <UpdateRow />
          <div className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">模型</span>
              <StatusChip state={rows.provider} />
            </div>
            <div className="settings-control">
              <select
                className="settings-select"
                aria-label="识别模型"
                value={asr?.id ?? preferences.provider.id}
                disabled={providerBusy || !asr || !preferences.provider.selectable}
                aria-describedby="settings-provider-reason"
                onChange={(event) =>
                  onProviderChange(event.target.value as SelectableAsrProviderId)
                }
              >
                {(asr?.options ?? [{ id: preferences.provider.id, label: preferences.provider.label }]).map(
                  (option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  )
                )}
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
