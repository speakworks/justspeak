import { describe, expect, it } from 'vitest'
import raw from '../resources/llm-models.json'
import { findLlmModel, parseLlmModelCatalog } from '../src/core/llm/model-catalog'

describe('LLM model catalog', () => {
  it('parses the committed catalog and pins a SHA-256', () => {
    const catalog = parseLlmModelCatalog(raw)
    const model = findLlmModel(catalog, catalog.models[0]?.id ?? '')
    expect(model.license).toBe('Apache-2.0')
    expect(model.file.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(model.file.sizeBytes).toBeGreaterThan(0)
  })

  it('fails closed on an invalid digest or missing file', () => {
    expect(() =>
      parseLlmModelCatalog({
        schemaVersion: 1,
        models: [
          {
            ...raw.models[0],
            file: { ...raw.models[0].file, sha256: 'not-a-digest' }
          }
        ]
      })
    ).toThrow(/invalid/)
    expect(() =>
      parseLlmModelCatalog({ schemaVersion: 1, models: [{ ...raw.models[0], file: undefined }] })
    ).toThrow(/no file/)
  })
})
