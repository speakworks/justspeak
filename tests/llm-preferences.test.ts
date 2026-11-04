import { describe, expect, it } from 'vitest'
import { mergePreferences, planPreferenceSet } from '../src/core/preferences/merge'

describe('LLM preferences', () => {
  it('accepts a valid local backend', () => {
    const result = mergePreferences({}, { llmBackend: 'local' })
    expect(result.ok).toBe(true)
    expect(result.record.llmBackend).toBe('local')
  })

  it('accepts an OpenAI-compatible endpoint', () => {
    const result = mergePreferences({}, {
      llmBackend: 'endpoint',
      llmBaseUrl: 'http://127.0.0.1:11434',
      llmModel: 'qwen2.5:1.5b'
    })
    expect(result.ok).toBe(true)
    expect(result.record.llmBaseUrl).toBe('http://127.0.0.1:11434')
    expect(result.record.llmModel).toBe('qwen2.5:1.5b')
  })

  it('rejects an invalid backend or URL', () => {
    expect(mergePreferences({}, { llmBackend: 'cloud' }).ok).toBe(false)
    expect(mergePreferences({}, { llmBaseUrl: 'localhost:11434' }).ok).toBe(false)
    expect(planPreferenceSet({ llmBaseUrl: 'ftp://example.com' }).ok).toBe(false)
  })

  it('does not reject a patch with no LLM key', () => {
    expect(mergePreferences({}, { theme: 'dark' }).ok).toBe(true)
  })
})
