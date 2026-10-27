import { describe, expect, it } from 'vitest'
import type {
  AsrModelDescriptor,
  AsrProvider,
  AudioInput
} from '../src/core/asr/types'

export const TEST_MODEL: AsrModelDescriptor = {
  id: 'test-qwen3',
  version: 'test',
  runtime: 'test-runtime',
  files: [],
  sizeBytes: 1,
  license: 'Apache-2.0',
  sourceUrl: 'https://example.test/model',
  quantization: 'Q8_0',
  capabilities: {
    languages: ['zh', 'en'],
    streaming: false,
    punctuation: true,
    itn: true,
    timestamps: false,
    vad: false,
    maxAudioMs: 60_000,
    quantizations: ['Q8_0']
  }
}

export function pcmInput(samples = 1600, overrides: Partial<AudioInput> = {}): AudioInput {
  return {
    pcm: new Int16Array(samples).fill(100),
    sampleRate: 16000,
    channels: 1,
    durationMs: (samples / 16000) * 1000,
    ...overrides
  }
}

export interface ProviderContractHarness {
  name: string
  create(): AsrProvider
  model?: AsrModelDescriptor
}

/**
 * One ADR-0003 contract suite, parameterized over every adapter. The fake and
 * Qwen3 adapters must fail together when the interface changes.
 */
export function runProviderContract(harness: ProviderContractHarness): void {
  describe(`${harness.name} ADR-0003 contract`, () => {
    it('declares honest capabilities', async () => {
      const provider = harness.create()
      expect(provider.capabilities.streaming).toBe(false)
      expect(provider.capabilities.maxAudioMs).toBeGreaterThan(0)
      expect(provider.capabilities.languages.length).toBeGreaterThan(0)
      expect(provider.capabilities.quantizations.length).toBeGreaterThan(0)
      await provider.prepare(harness.model ?? TEST_MODEL)
      const health = await provider.health()
      expect(['ready', 'loading']).toContain(health.status)
    })

    it('returns a complete successful result', async () => {
      const provider = harness.create()
      await provider.prepare(harness.model ?? TEST_MODEL)
      const result = await provider.transcribe(pcmInput(), {})
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(typeof result.value.text).toBe('string')
      expect(result.value.latencyMs).toBeGreaterThanOrEqual(0)
      expect(result.value.modelId.length).toBeGreaterThan(0)
      expect(result.value.runtimeId.length).toBeGreaterThan(0)
      expect(Array.isArray(result.value.warnings)).toBe(true)
    })

    it('returns empty text for empty audio and never invents text', async () => {
      const provider = harness.create()
      await provider.prepare(harness.model ?? TEST_MODEL)
      const result = await provider.transcribe(pcmInput(0), {})
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.text).toBe('')
    })

    it('rejects audio over the declared duration limit', async () => {
      const provider = harness.create()
      await provider.prepare(harness.model ?? TEST_MODEL)
      const result = await provider.transcribe(
        pcmInput(1600, { durationMs: provider.capabilities.maxAudioMs + 1 }),
        {}
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('AUDIO_TOO_LONG')
    })

    it('rejects a non-16-kHz audio shape', async () => {
      const provider = harness.create()
      await provider.prepare(harness.model ?? TEST_MODEL)
      const result = await provider.transcribe(
        { ...pcmInput(), sampleRate: 48000 } as unknown as AudioInput,
        {}
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('INFERENCE_FAILED')
    })

    it('honours cancellation before inference', async () => {
      const provider = harness.create()
      await provider.prepare(harness.model ?? TEST_MODEL)
      const controller = new AbortController()
      controller.abort()
      const result = await provider.transcribe(pcmInput(), { signal: controller.signal })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('CANCELLED')
    })

    it('never throws raw errors across the boundary', async () => {
      const provider = harness.create()
      await provider.prepare(harness.model ?? TEST_MODEL)
      await expect(provider.transcribe(pcmInput(), {})).resolves.toBeTypeOf('object')
    })

    it('disposes cleanly through the provider interface', async () => {
      const provider = harness.create()
      await provider.prepare(harness.model ?? TEST_MODEL)
      await expect(provider.dispose()).resolves.toBeUndefined()
    })
  })
}
