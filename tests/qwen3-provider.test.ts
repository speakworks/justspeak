import { describe, expect, it, vi } from 'vitest'
import { Qwen3AsrProvider, type Qwen3Runner } from '../src/core/asr/qwen3-provider'
import type { ProviderResult } from '../src/core/asr/types'
import type { Qwen3RunnerResult } from '../src/core/asr/qwen3-provider'
import { pcmInput, runProviderContract, TEST_MODEL } from './provider-contract'

function runner(overrides: Partial<Qwen3Runner> = {}): Qwen3Runner {
  return {
    async run(_input, options): Promise<ProviderResult<Qwen3RunnerResult>> {
      if (options.signal?.aborted) {
        return { ok: false, error: { code: 'CANCELLED', message: 'cancelled', retryable: false } }
      }
      return { ok: true, value: { text: '你好，世界', language: 'zh' } }
    },
    async health() {
      return { status: 'ready', modelId: TEST_MODEL.id }
    },
    async dispose() {},
    ...overrides
  }
}

function provider(overrides: Partial<Qwen3Runner> = {}, defaultTimeoutMs = 500): Qwen3AsrProvider {
  return new Qwen3AsrProvider({
    model: TEST_MODEL,
    runner: runner(overrides),
    defaultTimeoutMs
  })
}

runProviderContract({
  name: 'qwen3',
  create: () =>
    new Qwen3AsrProvider({
      model: TEST_MODEL,
      runner: runner({
        async run(input) {
          return { ok: true, value: { text: input.pcm.length === 0 ? '' : '你好，世界' } }
        }
      })
    }),
  model: TEST_MODEL
})

describe('Qwen3 provider error and timeout mapping', () => {
  it('passes typed runner errors through unchanged', async () => {
    const result = await provider({
      async run() {
        return {
          ok: false,
          error: { code: 'MODEL_MISSING', message: 'model file is missing', retryable: true }
        }
      }
    }).transcribe(pcmInput(), {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('MODEL_MISSING')
      expect(result.error.retryable).toBe(true)
    }
  })

  it('maps a thrown runner error to INFERENCE_FAILED', async () => {
    const result = await provider({
      async run() {
        throw new Error('spawn failed')
      }
    }).transcribe(pcmInput(), {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INFERENCE_FAILED')
      expect(result.error.message).toContain('spawn failed')
    }
  })

  it('returns TIMEOUT when the runner never settles', async () => {
    const result = await provider(
      {
        async run() {
          return new Promise<ProviderResult<Qwen3RunnerResult>>(() => {})
        }
      },
      20
    ).transcribe(pcmInput(), {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TIMEOUT')
  })

  it('returns CANCELLED and ignores a late runner result', async () => {
    const late = provider(
      {
        async run() {
          await new Promise((resolve) => setTimeout(resolve, 60))
          return { ok: true, value: { text: 'late' } }
        }
      },
      500
    )
    const controller = new AbortController()
    const pending = late.transcribe(pcmInput(), { signal: controller.signal })
    setTimeout(() => controller.abort(), 5)
    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CANCELLED')
    await new Promise((resolve) => setTimeout(resolve, 70))
  })

  it('does not accumulate caller abort listeners across transcriptions', async () => {
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const abortAdds = (): number => add.mock.calls.filter(([type]) => type === 'abort').length
    const abortRemoves = (): number =>
      remove.mock.calls.filter(([type]) => type === 'abort').length

    const instance = provider()
    for (let i = 0; i < 5; i += 1) {
      const result = await instance.transcribe(pcmInput(), { signal: controller.signal })
      expect(result.ok).toBe(true)
      expect(abortAdds()).toBe(abortRemoves())
    }
  })

  it('reports model metadata and measured latency', async () => {
    let tick = 0
    const instance = new Qwen3AsrProvider({
      model: TEST_MODEL,
      runner: runner(),
      now: () => (tick += 10)
    })
    const result = await instance.transcribe(pcmInput(), {})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.modelId).toBe(TEST_MODEL.id)
      expect(result.value.runtimeId).toBe(TEST_MODEL.runtime)
      expect(result.value.latencyMs).toBe(10)
      expect(result.value.fallbackUsed).toBe(false)
    }
  })

  it('fails prepare when the runner is unavailable and reports health', async () => {
    const instance = provider({
      async health() {
        return { status: 'error', message: 'model missing' }
      }
    })
    await expect(instance.prepare(TEST_MODEL)).rejects.toThrow('model missing')
    const health = await instance.health()
    expect(health.status).not.toBe('ready')
  })

  it('rejects an unsupported language hint without running inference', async () => {
    const run = vi.fn(async () => ({ ok: true as const, value: { text: 'x' } }))
    const result = await provider({ run }).transcribe(pcmInput(), { languageHint: 'fr' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_LANGUAGE')
    expect(run).not.toHaveBeenCalled()
  })

  it('disposes the runner', async () => {
    const dispose = vi.fn(async () => {})
    const instance = provider({ dispose })
    await instance.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
