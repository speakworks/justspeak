import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  CaptureController,
  type AudioContextPort,
  type CaptureStreamPort,
  type WorkletNodePort
} from '../../core/capture/capture-controller'
import { DEFAULT_ACCELERATOR, acceleratorDisplayParts } from '../../core/hotkey/accelerator'
import {
  buildSettingsRows,
  validateHotkeyDraft,
  type SettingsRows
} from '../../core/preferences/view'
import { resolveTheme } from '../../core/theme/theme'
import type {
  AppState,
  AsrProviderSelection,
  ModelInfo,
  PreferencesView,
  ResolvedTheme,
  SelectableAsrProviderId,
  ThemePreference
} from '../../shared/ipc'
import { SettingsPanel } from './SettingsPanel'
import { Sidebar, type Destination } from './Sidebar'
import { HistoryPane } from './HistoryPane'
import { insertAtSelection, type InputSelection } from '../../core/shell/insert'

const WORKLET_CODE = `
class PcmCollector extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (!input) return true
    let sum = 0
    const copy = new Float32Array(input.length)
    for (let i = 0; i < input.length; i += 1) {
      const value = input[i]
      copy[i] = value
      sum += value * value
    }
    this.port.postMessage(
      { samples: copy, rms: Math.sqrt(sum / input.length), capturedAtMs: Math.round(currentTime * 1000) },
      [copy.buffer]
    )
    return true
  }
}
registerProcessor('pcm-collector', PcmCollector)
`

const STATE_LABEL: Record<AppState, string> = {
  idle: '就绪',
  recording: '录音中',
  transcribing: '识别中',
  pasting: '粘贴中',
  error: '出错了'
}

type View = Destination

/** Title and subtitle per destination; the home subtitle carries the hotkey. */
const PAGE: Record<View, { title: string; subtitle: string }> = {
  home: { title: '首页', subtitle: '' },
  history: { title: '历史记录', subtitle: '记录只保存在这台 Mac 上。' },
  dictionary: { title: '词典', subtitle: '专有名词和热词，识别时优先匹配。' },
  settings: { title: '设置', subtitle: '外观、快捷键与模型。' }
}

function createCaptureController(onLevel: (level: number) => void): CaptureController {
  return new CaptureController({
    getUserMedia: () =>
      navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      }) as Promise<CaptureStreamPort>,
    createContext: (sampleRate) =>
      new AudioContext({
        sampleRate,
        latencyHint: 'interactive'
      }) as unknown as AudioContextPort,
    addWorkletModule: async (context) => {
      const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'text/javascript' }))
      try {
        await (context as unknown as AudioContext).audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    createNode: (context) =>
      new AudioWorkletNode(
        context as unknown as AudioContext,
        'pcm-collector'
      ) as unknown as WorkletNodePort,
    createSink: (context) => {
      const gain = (context as unknown as AudioContext).createGain()
      gain.gain.value = 0
      return gain
    },
    connect: (stream, node, sink, context) => {
      const audioContext = context as unknown as AudioContext
      const source = audioContext.createMediaStreamSource(stream as unknown as MediaStream)
      const worklet = node as unknown as AudioWorkletNode
      const gain = sink as GainNode
      source.connect(worklet)
      worklet.connect(gain)
      gain.connect(audioContext.destination)
    },
    now: () => performance.now(),
    onBatch: (batch) => window.justspeak.sendPcmBatch(batch),
    onLevel,
    sendStarted: (atMs) => window.justspeak.sendCaptureStarted(atMs),
    sendStopped: (summary) => window.justspeak.sendCaptureStopped(summary),
    sendFailed: (message) => window.justspeak.sendCaptureFailed(message)
  })
}

export function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>('idle')
  const [message, setMessage] = useState<string | undefined>()
  const [modelInfo, setModelInfo] = useState<ModelInfo | undefined>()
  const [asr, setAsr] = useState<AsrProviderSelection | undefined>()
  /** The one renderer copy of persisted settings, replaced by main on every read. */
  const [preferences, setPreferences] = useState<PreferencesView | null>(null)
  const [preferencesError, setPreferencesError] = useState<string | undefined>()
  const [view, setView] = useState<View>('home')
  // The dictated text lives above the destination switch so a transcript that
  // lands while another destination is shown is not lost.
  const [input, setInput] = useState<InputSelection>({ value: '', start: 0, end: 0 })
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const composingRef = useRef(false)
  const pendingInsertRef = useRef<string | null>(null)
  const [hotkeyDraft, setHotkeyDraft] = useState(DEFAULT_ACCELERATOR)
  const [hotkeyFeedback, setHotkeyFeedback] = useState<string | undefined>()
  const [hotkeyError, setHotkeyError] = useState(false)
  const [hotkeyBusy, setHotkeyBusy] = useState(false)
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  )

  const controllerRef = useRef<CaptureController | null>(null)
  if (!controllerRef.current) {
    // The renderer no longer draws a level bar; the global pill takes its level
    // from main, so subscribing here would re-render the shell for nothing.
    controllerRef.current = createCaptureController(() => {})
  }

  const reportFailure = useCallback((error: unknown): void => {
    const detail = error instanceof Error ? error.message : String(error)
    setMessage(detail)
    window.justspeak.sendCaptureFailed(detail)
  }, [])

  const theme = preferences?.theme ?? 'system'

  // Resolve `system` against the OS appearance and publish the concrete value,
  // so the CSS never has to guess and a pinned choice wins over the OS.
  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(theme, systemTheme)
  }, [theme, systemTheme])

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const onChange = (event: MediaQueryListEvent): void => {
      setSystemTheme(event.matches ? 'dark' : 'light')
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Switching the ASR provider rebuilds the session in main, so the whole
  // status snapshot comes back and replaces what this renderer shows.
  const changeProvider = useCallback((next: SelectableAsrProviderId): void => {
    void window.justspeak
      .setAsrProvider(next)
      .then((status) => {
        setAsr(status.asr)
        setModelInfo(status.modelInfo)
        setState(status.state)
        setMessage(status.message)
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error))
      })
  }, [])

  // Adopt the live accelerator as the draft only when main reports a new one,
  // so typing in the panel is never overwritten by an unrelated refresh.
  const lastHotkey = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!preferences) return
    if (lastHotkey.current === preferences.hotkey) return
    lastHotkey.current = preferences.hotkey
    setHotkeyDraft(preferences.hotkey || DEFAULT_ACCELERATOR)
  }, [preferences])

  useEffect(() => {
    const unsubPreferences = window.justspeak.onPreferencesChanged((next) => {
      setPreferences(next)
      setPreferencesError(undefined)
      if (next.hotkeyMessage) {
        setHotkeyFeedback(next.hotkeyMessage)
        setHotkeyError(true)
      }
    })
    window.justspeak
      .getPreferences()
      .then((next) => {
        setPreferences(next)
        setPreferencesError(undefined)
      })
      .catch((error: unknown) => {
        setPreferencesError(error instanceof Error ? error.message : String(error))
      })
    return unsubPreferences
  }, [])

  const applyThemePreference = useCallback((next: ThemePreference): void => {
    setPreferencesError(undefined)
    void window.justspeak
      .setPreferences({ theme: next })
      .then((outcome) => {
        setPreferences(outcome.preferences)
        if (!outcome.ok) setPreferencesError(outcome.message ?? '外观设置失败。')
      })
      .catch((error: unknown) => {
        setPreferencesError(error instanceof Error ? error.message : String(error))
      })
  }, [])

  const reloadPreferences = useCallback((): void => {
    setPreferencesError(undefined)
    void window.justspeak
      .getPreferences()
      .then((next) => {
        setPreferences(next)
        setPreferencesError(undefined)
      })
      .catch((error: unknown) => {
        setPreferencesError(error instanceof Error ? error.message : String(error))
      })
  }, [])

  const hotkeyDraftState = validateHotkeyDraft(hotkeyDraft, preferences?.hotkey ?? '')

  const applyHotkey = useCallback((): void => {
    const parsed = validateHotkeyDraft(hotkeyDraft, preferences?.hotkey ?? '')
    if (!parsed.ok || !parsed.accelerator) {
      setHotkeyFeedback(parsed.message)
      setHotkeyError(true)
      return
    }
    setHotkeyBusy(true)
    void window.justspeak
      .setPreferences({ hotkey: parsed.accelerator })
      .then((outcome) => {
        // `preferences.hotkey` is what the OS accepted, which may be the
        // default after a refused binding; the message names what failed.
        setPreferences(outcome.preferences)
        setHotkeyError(!outcome.ok)
        setHotkeyFeedback(outcome.message)
      })
      .catch((error: unknown) => {
        setHotkeyError(true)
        setHotkeyFeedback(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setHotkeyBusy(false))
  }, [hotkeyDraft, preferences?.hotkey])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return
    let disposed = false
    let sawStateEvent = false

    const unsubState = window.justspeak.onState((next, nextMessage) => {
      sawStateEvent = true
      setState(next)
      setMessage(nextMessage)
    })
    const unsubInsert = window.justspeak.onTranscriptInsert((text) => {
      // Inserting mid-composition would split an IME session and drop the
      // pre-edit text, so the transcript waits for compositionend.
      if (composingRef.current) {
        pendingInsertRef.current = text
        return
      }
      applyInsert(text)
    })
    const unsubCommand = window.justspeak.onRecordingCommand((command) => {
      if (command === 'start') {
        void controller.start().catch(reportFailure)
      } else {
        void controller.stop().catch(reportFailure)
      }
    })

    window.justspeak.sendRendererReady()

    void window.justspeak
      .getState()
      .then((status) => {
        if (disposed) return
        setModelInfo(status.modelInfo)
        setAsr(status.asr)
        if (sawStateEvent) return
        setState(status.state)
        setMessage(status.message)
        if (status.state === 'recording') {
          void controller.start().catch(reportFailure)
        }
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error))
      })

    return () => {
      disposed = true
      unsubInsert()
      unsubState()
      unsubCommand()
      void controller.dispose()
    }
  }, [reportFailure])

  const isBusy = state === 'transcribing' || state === 'pasting'
  const liveError = hotkeyDraftState.ok ? undefined : hotkeyDraftState.message
  const hotkeyMessage = hotkeyFeedback ?? liveError
  const hotkeyMessageIsError = hotkeyError || liveError !== undefined
  const rows: SettingsRows | null = preferences ? buildSettingsRows(preferences) : null
  const hotkeyLabel = acceleratorDisplayParts(
    preferences?.hotkey || DEFAULT_ACCELERATOR
  ).join('')

  const applyInsert = useCallback((text: string): void => {
    setInput((current) => {
      const next = insertAtSelection(current, text)
      // React paints first; then the caret goes where the text ended.
      requestAnimationFrame(() => {
        const node = inputRef.current
        if (!node) return
        node.focus()
        node.setSelectionRange(next.caret, next.caret)
      })
      return { value: next.value, start: next.caret, end: next.caret }
    })
  }, [])

  const settingsPanelProps = {
    preferences,
    rows,
    error: preferencesError,
    hotkeyDraft,
    hotkeyMessage,
    hotkeyMessageIsError,
    hotkeyBusy,
    canApplyHotkey: hotkeyDraftState.ok && hotkeyDraftState.dirty,
    onHotkeyDraft: (value: string) => {
      setHotkeyDraft(value)
      setHotkeyFeedback(undefined)
      setHotkeyError(false)
    },
    onApplyHotkey: applyHotkey,
    onTheme: applyThemePreference,
    onReload: reloadPreferences
  }

  const subtitle =
    view === 'home' && hotkeyLabel
      ? `按 ${hotkeyLabel} 随时开始说话`
      : PAGE[view].subtitle

  return (
    <div className="shell">
      <Sidebar
        current={view}
        onSelect={setView}
        providerLabel={preferences?.provider.label}
        providerLive={preferences?.provider.selectable ?? false}
      />
      <main className="content">
        <header className="page-header">
          <div>
            <h1 className="page-title">{PAGE[view].title}</h1>
            <p className="page-subtitle">{subtitle}</p>
          </div>
          <div className="page-actions">
            {view === 'settings' ? (
              <button type="button" className="quiet-button" onClick={() => setView('home')}>
                完成
              </button>
            ) : asr ? (
              <span className="provider">
                <select
                  className="provider-select"
                  aria-label="识别模型"
                  value={asr.id}
                  disabled={isBusy || state === 'recording'}
                  onChange={(event) =>
                    changeProvider(event.target.value as SelectableAsrProviderId)
                  }
                >
                  {asr.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <svg className="provider-chevron" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
                </svg>
              </span>
            ) : null}
          </div>
        </header>

        {view === 'home' ? (
          <section className="pane">
            <div className={`sheet ${state}`}>
              <label className="sheet-label" htmlFor="dictation-input">
                口述内容
              </label>
              <div className="sheet-body">
                <textarea
                  ref={inputRef}
                  id="dictation-input"
                  className="dictation-input"
                  value={input.value}
                  spellCheck={false}
                  onChange={(event) => {
                    const node = event.currentTarget
                    setInput({
                      value: node.value,
                      start: node.selectionStart ?? node.value.length,
                      end: node.selectionEnd ?? node.value.length
                    })
                  }}
                  onSelect={(event) => {
                    const node = event.currentTarget
                    setInput((current) => ({
                      ...current,
                      start: node.selectionStart ?? 0,
                      end: node.selectionEnd ?? 0
                    }))
                  }}
                  onCompositionStart={() => {
                    composingRef.current = true
                  }}
                  onCompositionEnd={() => {
                    composingRef.current = false
                    const pending = pendingInsertRef.current
                    if (pending === null) return
                    pendingInsertRef.current = null
                    applyInsert(pending)
                  }}
                />
                {input.value === '' ? (
                  <div className="composer-empty" aria-hidden="true">
                    <p className="composer-empty-title">直接说话，文字会落在这里</p>
                    <p className="composer-empty-hint">
                      也可以在任何 App 里说，识别完成后插入光标处
                    </p>
                  </div>
                ) : null}
              </div>
              {state === 'error' && message ? (
                <p className="sheet-message error">{message}</p>
              ) : null}
              <div className="sheet-foot">
                <span className="status">
                  <span className="status-dot" aria-hidden="true" />
                  {STATE_LABEL[state]}
                </span>
                <span className="sheet-hint">{hotkeyLabel}</span>
              </div>
            </div>
          </section>
        ) : view === 'settings' ? (
          <section className="pane">
            <SettingsPanel section="settings" {...settingsPanelProps} />
          </section>
        ) : view === 'dictionary' ? (
          <section className="pane">
            <SettingsPanel section="vocabulary" {...settingsPanelProps} />
          </section>
        ) : (
          <HistoryPane />
        )}
      </main>
    </div>
  )
}
