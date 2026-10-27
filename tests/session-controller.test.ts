import { describe, expect, it, vi } from 'vitest'
import type { AsrProvider, AudioInput } from '../src/core/asr/types'
import {
  EMPTY_CAPTURE_MESSAGE,
  INVALID_SUMMARY_MESSAGE,
  SessionController,
  STOP_MISSING_MESSAGE,
  UNSUPPORTED_SAMPLE_RATE_MESSAGE,
  type SessionControllerDeps
} from '../src/core/session/session-controller'
import { PcmBuffer } from '../src/main/pcm-buffer'
import type { AppState, RecordingSummary, TranscriptEvent } from '../src/shared/ipc'

const SUMMARY: RecordingSummary = {
  durationMs: 100,
  samples: 1600,
  sampleRate: 16000,
  rms: 0.1
}

function fakeProvider(
  result: Awaited<ReturnType<AsrProvider['transcribe']>> = {
    ok: true,
    value: {
      text: '你好',
      language: 'zh',
      latencyMs: 5,
      modelId: 'fake',
      runtimeId: 'fake',
      warnings: []
    }
  }
): AsrProvider {
  return {
    id: 'test',
    capabilities: {
      languages: ['zh'],
      streaming: false,
      punctuation: true,
      itn: true,
      timestamps: false,
      vad: false,
      maxAudioMs: 60_000,
      quantizations: ['Q8_0']
    },
    async prepare() {},
    async transcribe() {
      return result
    },
    async dispose() {},
    async health() {
      return { status: 'ready' }
    }
  }
}

function setup(overrides: Partial<SessionControllerDeps> = {}) {
  let now = 1000
  const states: Array<{ state: AppState; message?: string }> = []
  const transcripts: TranscriptEvent[] = []
  const pastes: string[] = []
  const provider = fakeProvider()
  const transcribe = vi.spyOn(provider, 'transcribe')

  const deps: SessionControllerDeps = {
    provider,
    paste: async (text) => {
      pastes.push(text)
    },
    sendState: (state, message) => states.push({ state, message }),
    sendTranscript: (event) => transcripts.push(event),
    fake: true,
    getAudio: (summary): AudioInput => ({
      pcm: new Int16Array(1600).fill(7),
      sampleRate: 16000,
      channels: 1,
      durationMs: summary.durationMs
    }),
    now: () => now,
    ...overrides
  }
  const controller = new SessionController(deps)

  return {
    controller,
    states,
    transcripts,
    pastes,
    transcribe,
    advance: (ms: number) => {
      now += ms
    }
  }
}

describe('session state machine', () => {
  it('runs the happy path and emits one transcript', async () => {
    const harness = setup()
    expect(harness.controller.toggle(true)).toBe('start')
    expect(harness.controller.state).toBe('recording')
    harness.advance(1000)
    expect(harness.controller.toggle(true)).toBe('stop')
    expect(harness.controller.state).toBe('transcribing')

    await harness.controller.handleCaptureStopped(SUMMARY)

    expect(harness.states.map((entry) => entry.state)).toEqual([
      'recording',
      'transcribing',
      'pasting',
      'idle'
    ])
    expect(harness.transcripts).toHaveLength(1)
    expect(harness.transcripts[0]).toMatchObject({ text: '你好', fake: true, durationMs: 100 })
    expect(harness.pastes).toEqual(['你好'])
    expect(harness.controller.state).toBe('idle')
  })

  it('ignores stale stop events', async () => {
    const harness = setup()
    await harness.controller.handleCaptureStopped(SUMMARY)
    expect(harness.states).toHaveLength(0)
    expect(harness.transcripts).toHaveLength(0)
  })

  it('rejects an invalid recording summary before ASR', async () => {
    const harness = setup()
    harness.controller.toggle(true)
    harness.advance(1000)
    harness.controller.toggle(true)
    await harness.controller.handleCaptureStopped({ durationMs: -1 })

    expect(harness.states.at(-1)).toEqual({ state: 'error', message: INVALID_SUMMARY_MESSAGE })
    expect(harness.transcribe).not.toHaveBeenCalled()
    expect(harness.transcripts).toHaveLength(0)
  })

  it('rejects an unsupported sample rate before ASR', async () => {
    const harness = setup()
    harness.controller.toggle(true)
    harness.advance(1000)
    harness.controller.toggle(true)
    await harness.controller.handleCaptureStopped({ ...SUMMARY, sampleRate: 48000 })

    expect(harness.states.at(-1)).toEqual({
      state: 'error',
      message: UNSUPPORTED_SAMPLE_RATE_MESSAGE
    })
    expect(harness.transcribe).not.toHaveBeenCalled()
  })

  it('surfaces capture failures and allows an error-from-idle retry', async () => {
    const harness = setup()
    expect(harness.controller.toggle(true)).toBe('start')
    harness.controller.handleCaptureFailed('设备丢失')
    expect(harness.states.at(-1)).toEqual({ state: 'error', message: '设备丢失' })

    harness.advance(100)
    expect(harness.controller.toggle(true)).toBe('ignore')
    harness.advance(400)
    expect(harness.controller.toggle(true)).toBe('start')
  })

  it('surfaces provider errors without a transcript or fallback', async () => {
    const harness = setup({
      provider: fakeProvider({
        ok: false,
        error: { code: 'MODEL_MISSING', message: '模型缺失，请运行 pnpm setup:asr', retryable: true }
      })
    })
    harness.controller.toggle(true)
    harness.advance(1000)
    harness.controller.toggle(true)
    await harness.controller.handleCaptureStopped(SUMMARY)

    expect(harness.states.at(-1)).toEqual({
      state: 'error',
      message: '模型缺失，请运行 pnpm setup:asr'
    })
    expect(harness.transcripts).toHaveLength(0)
    expect(harness.pastes).toHaveLength(0)
  })

  it('returns to idle with a notice for an empty capture', async () => {
    const harness = setup({ getAudio: () => null })
    harness.controller.toggle(true)
    harness.advance(1000)
    harness.controller.toggle(true)
    await harness.controller.handleCaptureStopped(SUMMARY)

    expect(harness.states.at(-1)).toEqual({ state: 'idle', message: EMPTY_CAPTURE_MESSAGE })
    expect(harness.transcribe).not.toHaveBeenCalled()
  })

  it('reports a missing stop event through the watchdog', () => {
    const harness = setup()
    harness.controller.toggle(true)
    harness.advance(1000)
    harness.controller.toggle(true)
    harness.controller.handleStopWatchdog()
    expect(harness.states.at(-1)).toEqual({ state: 'error', message: STOP_MISSING_MESSAGE })
  })

  it('retries once on a retryable INFERENCE_FAILED, then succeeds', async () => {
    let calls = 0
    const provider = fakeProvider()
    const original = provider.transcribe.bind(provider)
    provider.transcribe = async (input, options) => {
      calls += 1
      if (calls === 1) {
        return {
          ok: false,
          error: { code: 'INFERENCE_FAILED', message: 'transient', retryable: true }
        }
      }
      return original(input, options)
    }
    const harness = setup({ provider })
    harness.controller.toggle(true)
    harness.advance(1000)
    harness.controller.toggle(true)
    await harness.controller.handleCaptureStopped(SUMMARY)

    expect(calls).toBe(2)
    expect(harness.transcripts).toHaveLength(1)
  })

  it('retries once on TIMEOUT and then reports the error', async () => {
    const provider = fakeProvider()
    let calls = 0
    provider.transcribe = async () => {
      calls += 1
      return {
        ok: false,
        error: { code: 'TIMEOUT', message: 'too slow', retryable: true }
      }
    }
    const harness = setup({ provider })
    harness.controller.toggle(true)
    harness.advance(1000)
    harness.controller.toggle(true)
    await harness.controller.handleCaptureStopped(SUMMARY)

    expect(calls).toBe(2)
    expect(harness.states.at(-1)).toEqual({ state: 'error', message: 'too slow' })
  })

  it('does not retry cancellation or a missing model', async () => {
    for (const code of ['CANCELLED', 'MODEL_MISSING'] as const) {
      let calls = 0
      const provider = fakeProvider()
      provider.transcribe = async () => {
        calls += 1
        return {
          ok: false,
          error: { code, message: 'stop', retryable: code === 'MODEL_MISSING' }
        }
      }
      const harness = setup({ provider })
      harness.controller.toggle(true)
      harness.advance(1000)
      harness.controller.toggle(true)
      await harness.controller.handleCaptureStopped(SUMMARY)
      expect(calls).toBe(1)
    }
  })

  it('passes the configured timeout to the provider', async () => {
    const harness = setup({ transcribeTimeoutMs: 4321 })
    harness.controller.toggle(true)
    harness.advance(1000)
    harness.controller.toggle(true)
    await harness.controller.handleCaptureStopped(SUMMARY)
    expect(harness.transcribe).toHaveBeenCalledWith(expect.any(Object), { timeoutMs: 4321 })
  })

  it('drives real bounded PCM batches through the session', async () => {
    const buffer = new PcmBuffer()
    buffer.begin()
    buffer.append({ sequence: 0, capturedAtMs: 0, samples: new Int16Array(320).fill(1) })
    buffer.append({ sequence: 1, capturedAtMs: 20, samples: new Int16Array(320).fill(2) })

    const harness = setup({
      getAudio: (summary) => {
        const { pcm } = buffer.finish()
        return { pcm, sampleRate: 16000, channels: 1, durationMs: summary.durationMs }
      }
    })
    harness.controller.toggle(true)
    harness.advance(1000)
    harness.controller.toggle(true)
    await harness.controller.handleCaptureStopped(SUMMARY)

    expect(harness.transcribe).toHaveBeenCalledTimes(1)
    const audio = harness.transcribe.mock.calls[0]?.[0] as AudioInput
    expect(audio.pcm).toHaveLength(640)
    expect(audio.pcm[0]).toBe(1)
    expect(audio.pcm[639]).toBe(2)
    expect(harness.states.at(-1)?.state).toBe('idle')
  })
})
