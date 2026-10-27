import { describe, expect, it } from 'vitest'
import rawCatalog from '../resources/models.json'
import {
  findModel,
  findRuntime,
  parseModelCatalog,
  toModelDescriptor
} from '../src/core/asr/model-catalog'

const PINNED_SHA = 'f081b2d5e23bd669d92cc331d722a8a0681943b8e6f34b48996fd5c319b5acd8'
const PINNED_SIZE = 850423456

describe('embedded model catalog', () => {
  it('parses and pins the Qwen3 model digest and size', () => {
    const catalog = parseModelCatalog(rawCatalog)
    const model = findModel(catalog, 'qwen3-asr-0.6b-q8')
    expect(model.files).toHaveLength(1)
    expect(model.files[0]?.sha256).toBe(PINNED_SHA)
    expect(model.files[0]?.sizeBytes).toBe(PINNED_SIZE)
    expect(model.license).toBe('Apache-2.0')
    expect(model.quantization).toBe('Q8_0')
    expect(model.sourceUrl).toContain('Qwen3-ASR-0.6B-gguf')
    expect(model.files[0]?.url).toContain('7e7c69a577fa2725dfedbe34b5e999336e30a19b')
  })

  it('keeps the catalog audio limit aligned with the provider capability', () => {
    const catalog = parseModelCatalog(rawCatalog)
    const model = findModel(catalog, 'qwen3-asr-0.6b-q8')
    expect(model.capabilities.maxAudioMs).toBe(87 * 60 * 1000)
    expect(model.capabilities.languages).toEqual(
      expect.arrayContaining(['zh', 'en', 'mixed'])
    )
  })

  it('pins the runtime tag and commit', () => {
    const catalog = parseModelCatalog(rawCatalog)
    const runtime = findRuntime(catalog, 'transcribe.cpp-0.4.1')
    expect(runtime.tag).toBe('v0.4.1')
    expect(runtime.commit).toBe('4d7c1ccefd39e5a9ea36cca5f8fefc6dcc14b99b')
    expect(runtime.binary).toBe('build/bin/transcribe-cli')
  })

  it('converts to the ADR descriptor shape', () => {
    const catalog = parseModelCatalog(rawCatalog)
    const descriptor = toModelDescriptor(findModel(catalog, 'qwen3-asr-0.6b-q8'))
    expect(descriptor.id).toBe('qwen3-asr-0.6b-q8')
    expect(descriptor.files[0]).toEqual({
      path: 'qwen3-asr-0.6b/Qwen3-ASR-0.6B-Q8_0.gguf',
      sha256: PINNED_SHA,
      sizeBytes: PINNED_SIZE
    })
    expect(descriptor.capabilities.streaming).toBe(false)
  })

  it('fails closed on an unsupported schema', () => {
    expect(() => parseModelCatalog({ ...rawCatalog, schemaVersion: 2 })).toThrow(/schema/)
  })

  it('fails closed on a malformed digest', () => {
    const broken = structuredClone(rawCatalog)
    broken.models[0].files[0].sha256 = 'not-a-digest'
    expect(() => parseModelCatalog(broken)).toThrow(/invalid/)
  })

  it('fails closed on a missing file entry', () => {
    const broken = structuredClone(rawCatalog)
    broken.models[0].files = []
    expect(() => parseModelCatalog(broken)).toThrow(/missing required fields/)
  })
})
