import { describe, expect, it, vi } from 'vitest'
import { describeCapabilities } from '../src/core/asr/capabilities'
import type { ProviderResult } from '../src/core/asr/types'
import {
  SENSEVOICE_CAPABILITIES,
  SENSEVOICE_MAX_AUDIO_MS,
  SenseVoiceAsrProvider,
  type SenseVoiceRunner,
  type SenseVoiceRunnerResult
} from '../src/core/asr/sensevoice-provider'
import { pcmInput, runProviderContract, TEST_MODEL } from './provider-contract'

function runner(overrides: Partial<SenseVoiceRunner> = {}): SenseVoiceRunner {
  return {
    async run(input, options): Promise<ProviderResult<SenseVoiceRunnerResult>> {
      if (options.signal?.aborted) {
        return { ok: false, error: { code: 'CANCELLED', message: 'cancelled', retryable: false } }
      }
      return { ok: true, value: { text: input.pcm.length === 0 ? '' : '你好，世界', language: 'zh' } }
    },
    async health() {
      return { status: 'ready', modelId: TEST_MODEL.id }
    },
    async dispose() {},
    ...overrides
  }
}

function provider(overrides: Partial<SenseVoiceRunner> = {}, defaultTimeoutMs = 500): SenseVoiceAsrProvider {
  return new SenseVoiceAsrProvider({ model: TEST_MODEL, runner: runner(overrides), defaultTimeoutMs })
}

runProviderContract({
  name: 'sensevoice',
  create: () => new SenseVoiceAsrProvider({ model: TEST_MODEL, runner: runner() }),
  model: TEST_MODEL
})

describe('SenseVoice capabilities are honest', () => {
  it('declares final-only, no timestamps, no VAD, and the 30 s trained window', () => {
    expect(SENSEVOICE_CAPABILITIES.streaming).toBe(false)
    expect(SENSEVOICE_CAPABILITIES.timestamps).toBe(false)
    expect(SENSEVOICE_CAPABILITIES.vad).toBe(false)
    expect(SENSEVOICE_CAPABILITIES.punctuation).toBe(true)
    expect(SENSEVOICE_CAPABILITIES.itn).toBe(true)
    expect(SENSEVOICE_CAPABILITIES.maxAudioMs).toBe(SENSEVOICE_MAX_AUDIO_MS)
    expect(SENSEVOICE_CAPABILITIES.maxAudioMs).toBe(30_000)
    expect(SENSEVOICE_CAPABILITIES.languages).toEqual(['zh', 'yue', 'en', 'ja', 'ko'])
    expect(SENSEVOICE_CAPABILITIES.quantizations).toEqual(['Q8_0'])
  })

  it('accepts exactly 30 s and rejects 30 s + 1 ms without invoking the runner', async () => {
    const run = vi.fn(runner().run)
    const instance = provider({ run })

    const atLimit = await instance.transcribe(pcmInput(1600, { durationMs: 30_000 }), {})
    expect(atLimit.ok).toBe(true)

    const overLimit = await instance.transcribe(pcmInput(1600, { durationMs: 30_001 }), {})
    expect(overLimit.ok).toBe(false)
    if (!overLimit.ok) expect(overLimit.error.code).toBe('AUDIO_TOO_LONG')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('rejects a language outside the declared set without invoking the runner', async () => {
    const run = vi.fn(runner().run)
    const result = await provider({ run }).transcribe(pcmInput(), { languageHint: 'de' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_LANGUAGE')
    expect(run).not.toHaveBeenCalled()
  })

  it('describes the UI summary from capabilities alone', () => {
    expect(describeCapabilities(SENSEVOICE_CAPABILITIES)).toBe(
      '非流式 · 单次最长 30 秒 · zh/yue/en/ja/ko'
    )
  })

  it('returns empty text for digital silence without invoking the runner', async () => {
    const run = vi.fn(runner().run)
    const result = await provider({ run }).transcribe(
      pcmInput(16_000, { pcm: new Int16Array(16_000) }),
      {}
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.text).toBe('')
      expect(result.value.warnings.map((w) => w.code)).toEqual(['NO_SPEECH'])
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('still transcribes real speech above the silence threshold', async () => {
    const run = vi.fn(runner().run)
    const result = await provider({ run }).transcribe(pcmInput(1600), {})
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.text).toBe('你好，世界')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('documents the borderline amplitude: below the threshold is gated, at/above passes', async () => {
    // 0.002 * 32768 = 65.536, so 65/32768 is below the default gate and
    // 66/32768 is at/above it. RMS is compared with `<`, so the boundary passes.
    const belowRun = vi.fn(runner().run)
    const below = await provider({ run: belowRun }).transcribe(
      pcmInput(1600, { pcm: new Int16Array(1600).fill(65) }),
      {}
    )
    expect(below.ok).toBe(true)
    if (below.ok) expect(below.value.text).toBe('')
    expect(belowRun).not.toHaveBeenCalled()

    const aboveRun = vi.fn(runner().run)
    const above = await provider({ run: aboveRun }).transcribe(
      pcmInput(1600, { pcm: new Int16Array(1600).fill(66) }),
      {}
    )
    expect(above.ok).toBe(true)
    if (above.ok) expect(above.value.text).toBe('你好，世界')
    expect(aboveRun).toHaveBeenCalledTimes(1)
  })

  it('allows the silence threshold to be overridden per instance', async () => {
    const run = vi.fn(runner().run)
    const gated = new SenseVoiceAsrProvider({
      model: TEST_MODEL,
      runner: runner({ run }),
      silenceRmsThreshold: 0.01
    })
    // 100/32768 ≈ 0.00305 is above the default but below this override.
    const result = await gated.transcribe(pcmInput(1600), {})
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.text).toBe('')
    expect(run).not.toHaveBeenCalled()

    const open = new SenseVoiceAsrProvider({
      model: TEST_MODEL,
      runner: runner({ run }),
      silenceRmsThreshold: 0
    })
    await open.transcribe(pcmInput(1600, { pcm: new Int16Array(1600) }), {})
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('reports the catalog model id and runtime on a successful result', async () => {
    const result = await provider().transcribe(pcmInput(), {})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.modelId).toBe(TEST_MODEL.id)
      expect(result.value.runtimeId).toBe(TEST_MODEL.runtime)
      expect(result.value.fallbackUsed).toBe(false)
    }
  })
})
