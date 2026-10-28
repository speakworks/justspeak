import { describe, expect, it } from 'vitest'
import type {
  AsrProvider,
  AudioInput,
  ProviderResult,
  TranscriptionResult
} from '../src/core/asr/types'
import { SEGMENTED_MAX_SESSION_SAMPLES } from '../src/core/audio/segmenter'
import {
  NO_SPEECH_CODE,
  SEGMENT_FAILURE_CODE,
  createTranscriptionProvider,
  joinTranscripts
} from '../src/core/audio/segmented-provider'
import { SessionController } from '../src/core/session/session-controller'
import type { RecordingSummary, TranscriptEvent } from '../src/shared/ipc'
import { samplesFor, signalPcm } from './audio-signal'

const SPEECH_A = 0.1
const SPEECH_B = 0.2
const SPEECH_C = 0.3
const QUIET = 0.002
const PEAK_A = Math.round(SPEECH_A * 0x7fff)
const PEAK_B = Math.round(SPEECH_B * 0x7fff)
const PEAK_C = Math.round(SPEECH_C * 0x7fff)

function threeUtterances(): Int16Array {
  return signalPcm([
    { ms: 400, amplitude: SPEECH_A },
    { ms: 600, amplitude: QUIET },
    { ms: 400, amplitude: SPEECH_B },
    { ms: 600, amplitude: QUIET },
    { ms: 400, amplitude: SPEECH_C },
    { ms: 800, amplitude: QUIET }
  ])
}

function ok(text: string, modelId = 'fake-model'): ProviderResult<TranscriptionResult> {
  return {
    ok: true,
    value: {
      text,
      language: 'mixed',
      latencyMs: 1,
      modelId,
      runtimeId: 'fake-runtime',
      warnings: []
    }
  }
}

interface Harness {
  provider: AsrProvider
  calls: AudioInput[]
}

function harness(
  respond: (input: AudioInput, call: number) => ProviderResult<TranscriptionResult>
): Harness {
  const calls: AudioInput[] = []
  const provider: AsrProvider = {
    id: 'fake-under-test',
    capabilities: {
      languages: ['mixed'],
      streaming: false,
      punctuation: true,
      itn: true,
      timestamps: false,
      vad: false,
      maxAudioMs: 87 * 60 * 1000,
      quantizations: ['fake']
    },
    async prepare() {},
    async transcribe(input) {
      calls.push(input)
      return respond(input, calls.length - 1)
    },
    async dispose() {},
    async health() {
      return { status: 'ready' }
    }
  }
  return { provider, calls }
}

const SEGMENTER = { padMs: 0 }

describe('segmented transcription', () => {
  it('calls the provider in utterance order and concatenates in that order', async () => {
    const { provider, calls } = harness((_input, call) => ok(`seg-${call}`))
    const segmented = createTranscriptionProvider(provider, 'vad', { segmenter: SEGMENTER })

    const result = await segmented.transcribe(
      { pcm: threeUtterances(), sampleRate: 16000, channels: 1, durationMs: 3200 },
      {}
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls.map((input) => input.pcm[0])).toEqual([PEAK_A, PEAK_B, PEAK_C])
    expect(result.value.text).toBe('seg-0 seg-1 seg-2')
    expect(result.value.warnings).toEqual([])
  })

  it('keeps successful segments when one segment fails and names its index', async () => {
    const partialFailures: unknown[] = []
    const { provider, calls } = harness((input) => {
      if (input.pcm[0] === PEAK_B) {
        return {
          ok: false,
          error: { code: 'MODEL_LOAD_FAILED', message: 'bad segment', retryable: false }
        }
      }
      return ok(`ok-${Math.round((input.pcm[0] / 0x7fff) * 10)}`)
    })
    const segmented = createTranscriptionProvider(provider, 'vad', {
      segmenter: SEGMENTER,
      onPartialFailure: (error) => partialFailures.push(error)
    })

    const result = await segmented.transcribe(
      { pcm: threeUtterances(), sampleRate: 16000, channels: 1, durationMs: 3200 },
      {}
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls).toHaveLength(3)
    expect(result.value.text).toBe('ok-1 ok-3')
    expect(result.value.warnings).toHaveLength(1)
    expect(result.value.warnings[0].code).toBe(SEGMENT_FAILURE_CODE)
    expect(result.value.warnings[0].message).toContain('第 2 段')

    expect(partialFailures).toHaveLength(1)
    const failure = partialFailures[0] as {
      code: string
      failedIndices: number[]
      failures: Array<{ startSample: number; endSample: number }>
    }
    expect(failure.code).toBe(SEGMENT_FAILURE_CODE)
    expect(failure.failedIndices).toEqual([1])
    expect(failure.failures[0].startSample).toBe(samplesFor(1000))
    expect(failure.failures[0].endSample).toBe(samplesFor(1400))
  })

  it('reports every index when no segment succeeds', async () => {
    const { provider } = harness(() => ({
      ok: false,
      error: { code: 'INFERENCE_FAILED', message: 'boom', retryable: false }
    }))
    const segmented = createTranscriptionProvider(provider, 'vad', { segmenter: SEGMENTER })

    const result = await segmented.transcribe(
      { pcm: threeUtterances(), sampleRate: 16000, channels: 1, durationMs: 3200 },
      {}
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('INFERENCE_FAILED')
    expect(result.error.message).toContain('第 1 段')
    expect(result.error.message).toContain('第 2 段')
    expect(result.error.message).toContain('第 3 段')
  })

  it('retries one transient segment failure with the same audio', async () => {
    let failedOnce = false
    const { provider, calls } = harness((input) => {
      if (input.pcm[0] === PEAK_B && !failedOnce) {
        failedOnce = true
        return {
          ok: false,
          error: { code: 'TIMEOUT', message: 'slow', retryable: true }
        }
      }
      return ok('text')
    })
    const segmented = createTranscriptionProvider(provider, 'vad', { segmenter: SEGMENTER })

    const result = await segmented.transcribe(
      { pcm: threeUtterances(), sampleRate: 16000, channels: 1, durationMs: 3200 },
      {}
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls).toHaveLength(4)
    expect(calls[1].pcm).toEqual(calls[2].pcm)
    expect(result.value.text).toBe(joinTranscripts(['text', 'text', 'text']))
    expect(result.value.warnings).toEqual([])
  })

  it('returns an empty transcript and no provider call for all-silence audio', async () => {
    const { provider, calls } = harness(() => ok('must not be called'))
    const segmented = createTranscriptionProvider(provider, 'vad', { segmenter: SEGMENTER })

    const result = await segmented.transcribe(
      {
        pcm: signalPcm([{ ms: 1200, amplitude: QUIET }]),
        sampleRate: 16000,
        channels: 1,
        durationMs: 1200
      },
      {}
    )

    expect(calls).toHaveLength(0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.text).toBe('')
    expect(result.value.warnings[0].code).toBe(NO_SPEECH_CODE)
  })

  it('enforces the 120 s session bound before segmenting', async () => {
    const { provider, calls } = harness(() => ok('must not be called'))
    const segmented = createTranscriptionProvider(provider, 'vad', { segmenter: SEGMENTER })
    const pcm = new Int16Array(SEGMENTED_MAX_SESSION_SAMPLES + 1).fill(1000)

    const result = await segmented.transcribe(
      { pcm, sampleRate: 16000, channels: 1, durationMs: 120_001 },
      {}
    )

    expect(calls).toHaveLength(0)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('AUDIO_TOO_LONG')
    expect(result.error.retryable).toBe(false)
  })

  it('cannot be configured to accept more than the session bound', async () => {
    const { provider, calls } = harness(() => ok('must not be called'))
    const segmented = createTranscriptionProvider(provider, 'vad', {
      segmenter: { ...SEGMENTER, maxSessionSamples: SEGMENTED_MAX_SESSION_SAMPLES * 10 }
    })
    const pcm = new Int16Array(SEGMENTED_MAX_SESSION_SAMPLES + 1)

    const result = await segmented.transcribe(
      { pcm, sampleRate: 16000, channels: 1, durationMs: 120_001 },
      {}
    )

    expect(calls).toHaveLength(0)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('AUDIO_TOO_LONG')
  })

  it('declares honest capabilities for the segmented path', () => {
    const { provider } = harness(() => ok('x'))
    const segmented = createTranscriptionProvider(provider, 'vad', { segmenter: SEGMENTER })
    expect(segmented.capabilities.vad).toBe(true)
    expect(segmented.capabilities.streaming).toBe(false)
    expect(segmented.capabilities.maxAudioMs).toBe(120_000)
  })
})

describe('default single-shot path', () => {
  it('returns the inner provider untouched', () => {
    const { provider } = harness(() => ok('x'))
    expect(createTranscriptionProvider(provider, 'single')).toBe(provider)
  })

  it('makes exactly one provider call for audio that would split in vad mode', async () => {
    const pcm = signalPcm([
      { ms: 400, amplitude: SPEECH_A },
      { ms: 600, amplitude: QUIET },
      { ms: 400, amplitude: SPEECH_B },
      { ms: 800, amplitude: QUIET }
    ])
    const summary: RecordingSummary = {
      durationMs: 2200,
      samples: pcm.length,
      sampleRate: 16000,
      rms: 0.1
    }

    const run = async (mode: 'single' | 'vad') => {
      const { provider, calls } = harness((_input, call) => ok(`call-${call}`))
      const selected = createTranscriptionProvider(provider, mode, { segmenter: SEGMENTER })
      const transcripts: TranscriptEvent[] = []
      const controller = new SessionController({
        provider: selected,
        paste: async () => {},
        sendState: () => {},
        sendTranscript: (event) => transcripts.push(event),
        fake: true,
        getAudio: (): AudioInput => ({
          pcm,
          sampleRate: 16000,
          channels: 1,
          durationMs: summary.durationMs
        }),
        now: () => 1000
      })
      controller.toggle(true)
      controller.toggle(true)
      await controller.handleCaptureStopped(summary)
      return { calls, transcripts, controller }
    }

    const single = await run('single')
    expect(single.calls).toHaveLength(1)
    expect(single.calls[0].pcm).toHaveLength(pcm.length)
    expect(single.transcripts).toHaveLength(1)
    expect(single.transcripts[0].text).toBe('call-0')
    expect(single.controller.state).toBe('idle')

    const vad = await run('vad')
    expect(vad.calls).toHaveLength(2)
    expect(vad.transcripts[0].text).toBe('call-0 call-1')
  })
})

describe('joinTranscripts', () => {
  it('preserves order and only separates ASCII words', () => {
    expect(joinTranscripts(['你好', '世界'])).toBe('你好世界')
    expect(joinTranscripts(['hello', 'world'])).toBe('hello world')
    expect(joinTranscripts(['你好', 'world'])).toBe('你好world')
    expect(joinTranscripts([' one ', '', ' two '])).toBe('one two')
  })
})
