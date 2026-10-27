import path from 'node:path'
import { describe, expect, it } from 'vitest'
import rawCatalog from '../resources/models.json'
import { parseModelCatalog } from '../src/core/asr/model-catalog'
import { resolveAsrPaths } from '../src/main/asr/paths'

const catalog = parseModelCatalog(rawCatalog)

describe('ASR path resolution', () => {
  it('resolves the pinned runtime and model under appRoot/models', () => {
    const paths = resolveAsrPaths('/app', catalog, {})
    expect(paths.modelsDir).toBe(path.join('/app', 'models'))
    expect(paths.cliPath).toBe(
      path.join('/app', 'models/runtime/transcribe.cpp/build/bin/transcribe-cli')
    )
    expect(paths.modelPath).toBe(
      path.join('/app', 'models/qwen3-asr-0.6b/Qwen3-ASR-0.6B-Q8_0.gguf')
    )
    expect(paths.modelId).toBe('qwen3-asr-0.6b-q8')
    expect(paths.runtimeId).toBe('transcribe.cpp-0.4.1')
  })

  it('honours explicit environment overrides', () => {
    const paths = resolveAsrPaths('/app', catalog, {
      JUSTSPEAK_TRANSCRIBE_CLI: '/custom/transcribe-cli',
      JUSTSPEAK_QWEN3_MODEL: '/custom/model.gguf'
    } as NodeJS.ProcessEnv)
    expect(paths.cliPath).toBe('/custom/transcribe-cli')
    expect(paths.modelPath).toBe('/custom/model.gguf')
  })
})
