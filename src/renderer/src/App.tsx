import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  CaptureController,
  type AudioContextPort,
  type CaptureStreamPort,
  type WorkletNodePort
} from '../../core/capture/capture-controller'
import { describeCapabilities } from '../../core/asr/capabilities'
import { DEFAULT_ACCELERATOR } from '../../core/hotkey/accelerator'
import {
  buildSettingsRows,
  validateHotkeyDraft,
  type SettingsRows
} from '../../core/preferences/view'
import { THEME_LABEL, resolveTheme } from '../../core/theme/theme'
import type {
  AppState,
  AsrProviderSelection,
  ModelInfo,
  PreferencesView,
  RecordingSummary,
  ResolvedTheme,
  SelectableAsrProviderId,
  ThemePreference,
  TranscriptEvent
} from '../../shared/ipc'
import { SettingsPanel } from './SettingsPanel'

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

type View = 'dictation' | 'settings'

export function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>('idle')
  const [message, setMessage] = useState<string | undefined>()
  const [level, setLevel] = useState(0)
  const [transcript, setTranscript] = useState<TranscriptEvent | null>(null)
  const [modelInfo, setModelInfo] = useState<ModelInfo | undefined>()
  const [asr, setAsr] = useState<AsrProviderSelection | undefined>()
  /** The one renderer copy of persisted settings, replaced by main on every read. */
  const [preferences, setPreferences] = useState<PreferencesView | null>(null)
  const [preferencesError, setPreferencesError] = useState<string | undefined>()
  const [view, setView] = useState<View>('dictation')
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
    controllerRef.current = createCaptureController(setLevel)
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
    const unsubTranscript = window.justspeak.onTranscript((event) => {
      setTranscript(event)
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
      unsubState()
      unsubTranscript()
      unsubCommand()
      void controller.dispose()
    }
  }, [reportFailure])

  const isBusy = state === 'transcribing' || state === 'pasting'
  const liveError = hotkeyDraftState.ok ? undefined : hotkeyDraftState.message
  const hotkeyMessage = hotkeyFeedback ?? liveError
  const hotkeyMessageIsError = hotkeyError || liveError !== undefined
  const rows: SettingsRows | null = preferences ? buildSettingsRows(preferences) : null
  const settingsOpen = view === 'settings'

  return (
    <main className="app">
      <header className="header">
        <div>
          <p className="kicker">JustSpeak · M1</p>
          <h1>按一下，开始说话</h1>
        </div>
        <div className="header-actions">
          {asr ? (
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
          ) : null}
          <span className="appearance-indicator" title="当前外观">
            {preferences ? `外观：${THEME_LABEL[theme]}` : '外观：读取中'}
          </span>
          <button
            type="button"
            className="header-button"
            aria-expanded={settingsOpen}
            aria-controls="settings-panel"
            onClick={() => setView(settingsOpen ? 'dictation' : 'settings')}
          >
            {settingsOpen ? '返回' : '设置'}
          </button>
          <span className={`status ${state}`}>{STATE_LABEL[state]}</span>
        </div>
      </header>

      {settingsOpen ? (
        <SettingsPanel
          preferences={preferences}
          rows={rows}
          error={preferencesError}
          hotkeyDraft={hotkeyDraft}
          hotkeyMessage={hotkeyMessage}
          hotkeyMessageIsError={hotkeyMessageIsError}
          hotkeyBusy={hotkeyBusy}
          canApplyHotkey={hotkeyDraftState.ok && hotkeyDraftState.dirty}
          onHotkeyDraft={(value) => {
            setHotkeyDraft(value)
            setHotkeyFeedback(undefined)
            setHotkeyError(false)
          }}
          onApplyHotkey={applyHotkey}
          onTheme={applyThemePreference}
          onReload={reloadPreferences}
          onClose={() => setView('dictation')}
        />
      ) : (
        <section className="card">
          <button
            className={state === 'recording' ? 'record stop' : 'record'}
            disabled={isBusy}
            onClick={() => window.justspeak.toggleRecording()}
          >
            {state === 'recording' ? '停止并粘贴' : '开始录音'}
          </button>

          {modelInfo ? (
            // The URL is long enough to wrap onto a second row and waste height;
            // show it on hover instead. Not a link: the main process denies new
            // windows, so a clickable element here would be a dead affordance.
            // The source URL stays on hover. The capability summary comes from
            // the provider's declared flags, not from the selected id.
            <p
              className="hint model-meta"
              title={`${modelInfo.sourceUrl} · ${modelInfo.quantization}`}
            >
              模型：{modelInfo.name} · {modelInfo.license} ·{' '}
              {describeCapabilities(modelInfo.capabilities)}
            </p>
          ) : null}

          <div className="level" aria-hidden="true">
            <span style={{ width: `${Math.min(100, level * 800)}%` }} />
          </div>

          {message ? <p className="message">{message}</p> : null}
        </section>
      )}

      {settingsOpen ? null : (
        <section className="card transcript">
          <div className="transcript-head">
            <span>识别结果</span>
            {transcript ? (
              <span className="tag">{transcript.fake ? 'FAKE ASR' : 'LOCAL ASR'}</span>
            ) : null}
          </div>
          <p className={transcript ? 'transcript-text' : 'transcript-text empty'}>
            {transcript?.text ?? '还没有文本。按快捷键说一句话。'}
          </p>
          {transcript ? (
            <p className="meta">
              {`录音 ${Math.round(transcript.durationMs / 100) / 10}s · 识别 ${transcript.latencyMs}ms`}
              {transcript.applied?.length ? ` · 清理 ${transcript.applied.length} 项` : ''}
            </p>
          ) : null}
        </section>
      )}
    </main>
  )
}
