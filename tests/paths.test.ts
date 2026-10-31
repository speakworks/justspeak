import path from 'node:path'
import { describe, expect, it } from 'vitest'
import rawCatalog from '../resources/models.json'
import { parseModelCatalog } from '../src/core/asr/model-catalog'
import { resolveAsrPaths, resolveModelsDir } from '../src/main/asr/paths'

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

describe('models directory', () => {
  it('keeps a dev checkout inside the repository', () => {
    expect(
      resolveModelsDir({ appRoot: '/repo', userDataDir: '/data', packaged: false })
    ).toBe(path.join('/repo', 'models'))
  })

  it('uses userData when packaged, because appRoot is inside the read-only asar', () => {
    expect(
      resolveModelsDir({
        appRoot: '/Applications/JustSpeak.app/Contents/Resources/app.asar',
        userDataDir: '/Users/me/Library/Application Support/JustSpeak',
        packaged: true
      })
    ).toBe(path.join('/Users/me/Library/Application Support/JustSpeak', 'models'))
  })

  it('moves the runtime with the models directory even if the catalog uses a backslash', () => {
    const backslashCatalog = parseModelCatalog({
      ...rawCatalog,
      runtimes: [{ ...rawCatalog.runtimes[0], buildDir: 'models\\runtime\\transcribe.cpp' }]
    })
    const paths = resolveAsrPaths('/app', backslashCatalog, {}, 'qwen3', '/data/models')
    expect(paths.cliPath).toBe(
      path.join('/data/models/runtime/transcribe.cpp/build/bin/transcribe-cli')
    )
  })

  it('lets the caller override where resolveAsrPaths looks', () => {
    const paths = resolveAsrPaths('/app', catalog, {}, 'qwen3', '/data/models')
    expect(paths.modelsDir).toBe('/data/models')
    expect(paths.modelPath).toBe(
      path.join('/data/models/qwen3-asr-0.6b/Qwen3-ASR-0.6B-Q8_0.gguf')
    )
    expect(paths.cliPath).toBe(
      path.join('/data/models/runtime/transcribe.cpp/build/bin/transcribe-cli')
    )
  })
})
