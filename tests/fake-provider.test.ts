import { describe, expect, it } from 'vitest'
import { FakeAsrProvider } from '../src/core/asr/fake-provider'
import { runProviderContract, pcmInput } from './provider-contract'

runProviderContract({
  name: 'fake',
  create: () => new FakeAsrProvider({ delayMs: 0 })
})

describe('fake provider determinism', () => {
  it('returns the scripted demo text for non-empty audio', async () => {
    const provider = new FakeAsrProvider({ delayMs: 0 })
    const result = await provider.transcribe(pcmInput(), {})
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.text).toContain('JustSpeak')
  })

  it('returns a distinct empty result for an empty capture', async () => {
    const provider = new FakeAsrProvider({ delayMs: 0 })
    const result = await provider.transcribe(pcmInput(0), {})
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.text).toBe('')
  })
})
