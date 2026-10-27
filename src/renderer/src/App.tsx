import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  CaptureController,
  type AudioContextPort,
  type CaptureStreamPort,
  type WorkletNodePort
} from '../../core/capture/capture-controller'
import {
  THEME_LABEL,
  nextThemePreference,
  resolveTheme
} from '../../core/theme/theme'
import type {
  AppState,
  ModelInfo,
  RecordingSummary,
  ResolvedTheme,
  ThemePreference,
  TranscriptEvent
} from '../../shared/ipc'

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

export function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>('idle')
  const [message, setMessage] = useState<string | undefined>()
  const [level, setLevel] = useState(0)
  const [transcript, setTranscript] = useState<TranscriptEvent | null>(null)
  const [modelInfo, setModelInfo] = useState<ModelInfo | undefined>()
  const [theme, setTheme] = useState<ThemePreference>('system')
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

  const cycleTheme = useCallback((): void => {
    const next = nextThemePreference(theme)
    setTheme(next)
    void window.justspeak.setTheme(next).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : String(error))
    })
  }, [theme])

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
    const unsubTheme = window.justspeak.onThemeChanged((next) => setTheme(next))

    window.justspeak.sendRendererReady()

    void window.justspeak
      .getState()
      .then((status) => {
        if (disposed) return
        setModelInfo(status.modelInfo)
        if (status.theme) setTheme(status.theme)
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
      unsubTheme()
      void controller.dispose()
    }
  }, [reportFailure])

  const isBusy = state === 'transcribing' || state === 'pasting'

  return (
    <main className="app">
      <header className="header">
        <div>
          <p className="kicker">JustSpeak · M1</p>
          <h1>按一下，开始说话</h1>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={cycleTheme}
            title={`当前：${THEME_LABEL[theme]}；点击切换`}
            aria-label={`外观：${THEME_LABEL[theme]}，点击切换`}
          >
            {theme === 'system' ? '外观：跟随系统' : `外观：${THEME_LABEL[theme]}`}
          </button>
          <span className={`status ${state}`}>{STATE_LABEL[state]}</span>
        </div>
      </header>

      <section className="card">
        <button
          className={state === 'recording' ? 'record stop' : 'record'}
          disabled={isBusy}
          onClick={() => window.justspeak.toggleRecording()}
        >
          {state === 'recording' ? '停止并粘贴' : '开始录音'}
        </button>

        <p className="hint">
          快捷键 <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>Space</kbd> · 需要麦克风与辅助功能权限
        </p>

        {modelInfo ? (
          // The URL is long enough to wrap onto a second row and waste height;
          // show it on hover instead. Not a link: the main process denies new
          // windows, so a clickable element here would be a dead affordance.
          <p className="hint model-meta" title={modelInfo.sourceUrl}>
            模型：{modelInfo.name} · {modelInfo.license} · 来源{' '}
            {modelInfo.sourceUrl.replace(/^https?:\/\//, '').split('/')[0]}
          </p>
        ) : null}

        <div className="level" aria-hidden="true">
          <span style={{ width: `${Math.min(100, level * 800)}%` }} />
        </div>

        {message ? <p className="message">{message}</p> : null}
      </section>

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
            录音 {Math.round(transcript.durationMs / 100) / 10}s · 识别 {transcript.latencyMs}ms
          </p>
        ) : null}
      </section>
    </main>
  )
}
