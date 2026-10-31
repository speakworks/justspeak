import path from 'node:path'
import { describe, expect, it } from 'vitest'
import rawCatalog from '../resources/models.json'
import { FakeAsrProvider } from '../src/core/asr/fake-provider'
import { parseModelCatalog } from '../src/core/asr/model-catalog'
import { QWEN3_CAPABILITIES, Qwen3AsrProvider } from '../src/core/asr/qwen3-provider'
import {
  SENSEVOICE_CAPABILITIES,
  SenseVoiceAsrProvider
} from '../src/core/asr/sensevoice-provider'
import { buildProvider } from '../src/main/asr/providers'

const catalog = parseModelCatalog(rawCatalog)

function build(mode: 'qwen3' | 'sensevoice' | 'fake') {
  return buildProvider({ mode, appRoot: '/app', catalog, env: {} })
}

describe('fake-driven provider selection', () => {
  it('builds the deterministic fake without model files or network', () => {
    const built = build('fake')
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.mode).toBe('fake')
    expect(built.provider).toBeInstanceOf(FakeAsrProvider)
    expect(built.provider.health).toBeTypeOf('function')
  })

  it('builds qwen3 from its catalog entry', () => {
    const built = build('qwen3')
    expect(built.ok).toBe(true)
    if (!built.ok || built.mode === 'fake') return
    expect(built.provider).toBeInstanceOf(Qwen3AsrProvider)
    expect(built.provider.id).toBe('qwen3-asr-0.6b-q8')
    expect(built.model.id).toBe('qwen3-asr-0.6b-q8')
    expect(built.provider.capabilities).toEqual(QWEN3_CAPABILITIES)
    expect(built.paths.modelPath).toBe(
      path.join('/app', 'models', 'qwen3-asr-0.6b', 'Qwen3-ASR-0.6B-Q8_0.gguf')
    )
  })

  it('builds the SenseVoice provider from its catalog entry', () => {
    const built = build('sensevoice')
    expect(built.ok).toBe(true)
    if (!built.ok || built.mode === 'fake') return
    expect(built.provider).toBeInstanceOf(SenseVoiceAsrProvider)
    expect(built.provider.id).toBe('sensevoice-small-q8')
    expect(built.model.id).toBe('sensevoice-small-q8')
    expect(built.provider.capabilities).toEqual(SENSEVOICE_CAPABILITIES)
    expect(built.paths.modelPath).toBe(
      path.join('/app', 'models', 'sensevoice-small', 'SenseVoiceSmall-Q8_0.gguf')
    )
  })

  it('honours a per-provider model path override', () => {
    const built = buildProvider({
      mode: 'sensevoice',
      appRoot: '/app',
      catalog,
      env: { JUSTSPEAK_SENSEVOICE_MODEL: '/custom/sensevoice.gguf' } as NodeJS.ProcessEnv
    })
    expect(built.ok).toBe(true)
    if (built.ok && built.mode !== 'fake') {
      expect(built.paths.modelPath).toBe('/custom/sensevoice.gguf')
    }
  })

  it('fails visibly when the selected provider is absent from the catalog', () => {
    const partial = { ...catalog, models: catalog.models.filter((m) => m.id !== 'sensevoice-small-q8') }
    const built = buildProvider({ mode: 'sensevoice', appRoot: '/app', catalog: partial, env: {} })
    expect(built.ok).toBe(false)
    if (!built.ok) expect(built.message).toContain('sensevoice')
  })
})

describe('buildProvider models directory wiring', () => {
  it('resolves the runtime and the weights under the directory the caller passes', () => {
    // The packaged app passes userData/models. This covers the hop from
    // buildProvider to resolveAsrPaths; the main -> buildProvider wiring is
    // exercised only by a packaged run.
    const built = buildProvider({
      mode: 'qwen3',
      appRoot: '/app',
      modelsDir: '/data/models',
      catalog,
      env: {}
    })
    expect(built.ok).toBe(true)
    if (!built.ok || built.mode === 'fake') return
    expect(built.paths.modelsDir).toBe('/data/models')
    expect(built.paths.modelPath).toBe(
      path.join('/data/models/qwen3-asr-0.6b/Qwen3-ASR-0.6B-Q8_0.gguf')
    )
    expect(built.paths.cliPath).toBe(
      path.join('/data/models/runtime/transcribe.cpp/build/bin/transcribe-cli')
    )
  })
})
