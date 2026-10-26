import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState, RecordingSummary, TranscriptEvent } from '../../shared/ipc'

const WORKLET_CODE = `
class PcmCollector extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (!input) return true
    let sum = 0
    for (let i = 0; i < input.length; i += 1) {
      const value = input[i]
      sum += value * value
    }
    this.port.postMessage({ rms: Math.sqrt(sum / input.length), samples: input.length })
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

export function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>('idle')
  const [message, setMessage] = useState<string | undefined>()
  const [level, setLevel] = useState(0)
  const [transcript, setTranscript] = useState<TranscriptEvent | null>(null)

  const contextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const startedAtRef = useRef(0)
  const samplesRef = useRef(0)
  const rmsBlocksRef = useRef(0)
  const rmsSumRef = useRef(0)
  const lastLevelAtRef = useRef(0)
  const sessionRef = useRef(0)
  const startingRef = useRef(false)
  const cancelledRef = useRef(false)

  const releaseCapture = useCallback(async (): Promise<void> => {
    const context = contextRef.current
    nodeRef.current?.port.close()
    nodeRef.current?.disconnect()
    sourceRef.current?.disconnect()
    gainRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((track) => track.stop())

    contextRef.current = null
    streamRef.current = null
    sourceRef.current = null
    nodeRef.current = null
    gainRef.current = null
    setLevel(0)

    if (context && context.state !== 'closed') {
      void context.close().catch(() => {})
    }
  }, [])

  const startCapture = useCallback(async (): Promise<void> => {
    if (startingRef.current || contextRef.current) return

    const session = sessionRef.current + 1
    sessionRef.current = session
    cancelledRef.current = false
    startingRef.current = true

    let stream: MediaStream | null = null
    let context: AudioContext | null = null

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
      if (cancelledRef.current || session !== sessionRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      context = new AudioContext({ sampleRate: 16000 })
      const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'text/javascript' }))
      try {
        await context.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      if (cancelledRef.current || session !== sessionRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        await context.close().catch(() => {})
        return
      }

      const source = context.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(context, 'pcm-collector')
      const gain = context.createGain()
      gain.gain.value = 0

      samplesRef.current = 0
      rmsBlocksRef.current = 0
      rmsSumRef.current = 0
      lastLevelAtRef.current = 0
      node.port.onmessage = (event: MessageEvent<{ rms: number; samples: number }>) => {
        samplesRef.current += event.data.samples
        rmsBlocksRef.current += 1
        rmsSumRef.current += event.data.rms
        const now = performance.now()
        if (now - lastLevelAtRef.current > 50) {
          lastLevelAtRef.current = now
          setLevel(event.data.rms)
        }
      }

      source.connect(node)
      node.connect(gain)
      gain.connect(context.destination)

      contextRef.current = context
      streamRef.current = stream
      sourceRef.current = source
      nodeRef.current = node
      gainRef.current = gain
      startedAtRef.current = performance.now()
      console.log('[capture] started', context.sampleRate)
      window.justspeak.sendCaptureStarted(startedAtRef.current)
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      if (context && context.state !== 'closed') {
        await context.close().catch(() => {})
      }
      throw error
    } finally {
      startingRef.current = false
    }
  }, [])

  const stopCapture = useCallback(async (): Promise<void> => {
    if (startingRef.current) {
      cancelledRef.current = true
      sessionRef.current += 1
      window.justspeak.sendCaptureFailed('录音启动被取消，请重试。')
      return
    }

    const context = contextRef.current
    if (!context) {
      window.justspeak.sendCaptureFailed('没有可停止的录音，请重试。')
      return
    }

    const summary: RecordingSummary = {
      durationMs: Math.round(performance.now() - startedAtRef.current),
      samples: samplesRef.current,
      sampleRate: context.sampleRate,
      rms: rmsBlocksRef.current > 0 ? rmsSumRef.current / rmsBlocksRef.current : 0
    }

    await releaseCapture()
    console.log('[capture] stopped', summary)
    window.justspeak.sendCaptureStopped(summary)
  }, [releaseCapture])

  useEffect(() => {
    let disposed = false
    const unsubState = window.justspeak.onState((next, nextMessage) => {
      setState(next)
      setMessage(nextMessage)
    })
    const unsubTranscript = window.justspeak.onTranscript((event) => {
      setTranscript(event)
    })
    const unsubCommand = window.justspeak.onRecordingCommand((command) => {
      if (command === 'start') {
        void startCapture().catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error)
          setMessage(detail)
          window.justspeak.sendCaptureFailed(detail)
        })
      } else {
        void stopCapture()
      }
    })

    window.justspeak.sendRendererReady()

    void window.justspeak
      .getState()
      .then((status) => {
        if (disposed) return
        setState(status.state)
        setMessage(status.message)
        if (status.state === 'recording') {
          void startCapture().catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error)
            setMessage(detail)
            window.justspeak.sendCaptureFailed(detail)
          })
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
      void releaseCapture()
    }
  }, [releaseCapture, startCapture, stopCapture])

  const isBusy = state === 'transcribing' || state === 'pasting'

  return (
    <main className="app">
      <header className="header">
        <div>
          <p className="kicker">JustSpeak · M0 walking skeleton</p>
          <h1>按一下，开始说话</h1>
        </div>
        <span className={`status ${state}`}>{STATE_LABEL[state]}</span>
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

        <div className="level" aria-hidden="true">
          <span style={{ width: `${Math.min(100, level * 800)}%` }} />
        </div>

        {message ? <p className="message">{message}</p> : null}
      </section>

      <section className="card transcript">
        <div className="transcript-head">
          <span>识别结果</span>
          {transcript ? <span className="tag">{transcript.fake ? 'FAKE ASR' : 'ASR'}</span> : null}
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
