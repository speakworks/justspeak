import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LlmManager } from '../src/main/llm/manager'

// The key store asks Electron's safeStorage; unit tests run without Electron,
// and no key is stored in these fixtures. Vitest hoists this above the imports.
vi.mock('electron', () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: async () => false,
    encryptStringAsync: async () => Buffer.from(''),
    decryptStringAsync: async () => ''
  }
}))

const SIZE = 4
const directories: string[] = []

function makeRoot(): { root: string; userData: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'justspeak-llm-manager-'))
  directories.push(root)
  const userData = path.join(root, 'userData')
  mkdirSync(path.join(root, 'resources/llm'), { recursive: true })
  writeFileSync(
    path.join(root, 'resources/llm-models.json'),
    JSON.stringify({
      schemaVersion: 1,
      models: [
        {
          id: 'test-model',
          name: 'Test model',
          version: '1',
          file: {
            path: 'test.gguf',
            url: 'https://example.com/test.gguf',
            sha256: 'a'.repeat(64),
            sizeBytes: SIZE
          },
          license: 'Apache-2.0',
          sourceUrl: 'https://example.com',
          quantization: 'Q4_K_M'
        }
      ]
    })
  )
  return { root, userData }
}

async function manager(root: string, userData: string): Promise<LlmManager> {
  return LlmManager.create({
    appRoot: root,
    resourcesPath: path.join(root, 'resources'),
    packaged: false,
    userDataDir: userData
  })
}

const LOCAL = { backend: 'local' as const, baseUrl: '', model: '' }

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('LlmManager status', () => {
  it('reports missing runtime and model without claiming local is ready', async () => {
    const { root, userData } = makeRoot()
    const llm = await manager(root, userData)
    const status = await llm.status(LOCAL)
    expect(status.local).toMatchObject({
      runtimeReady: false,
      modelReady: false,
      state: 'idle'
    })
    expect(status.message).toContain('运行时缺失')
    await llm.dispose(true)
  })

  it('checks the downloaded model size, not just its existence', async () => {
    const { root, userData } = makeRoot()
    writeFileSync(path.join(root, 'resources/llm/llama-server'), '')
    const modelDir = path.join(userData, 'models/llm')
    mkdirSync(modelDir, { recursive: true })
    const modelPath = path.join(modelDir, 'test.gguf')
    writeFileSync(modelPath, '1234')

    const llm = await manager(root, userData)
    const ready = await llm.status(LOCAL)
    expect(ready.local).toMatchObject({ runtimeReady: true, modelReady: true, state: 'idle' })
    expect(ready.message).toContain('下次听写时启动')

    truncateSync(modelPath, SIZE - 1)
    const truncated = await llm.status(LOCAL)
    expect(truncated.local.modelReady).toBe(false)
    expect(truncated.message).toContain('文件不完整')
    // The corrector refuses to load a truncated file even though it exists.
    llm.configure(LOCAL)
    expect(await llm.corrector.warmup()).toBe(false)
    expect(llm.corrector.localStatus.error).toContain('不完整')
    await llm.dispose(true)
  })

  it('surfaces a failed sidecar instead of repeating the file-based status', async () => {
    const { root, userData } = makeRoot()
    // An empty, non-executable binary fails to spawn; the status must say so.
    writeFileSync(path.join(root, 'resources/llm/llama-server'), '')
    const modelDir = path.join(userData, 'models/llm')
    mkdirSync(modelDir, { recursive: true })
    writeFileSync(path.join(modelDir, 'test.gguf'), '1234')

    const states: string[] = []
    const llm = await LlmManager.create({
      appRoot: root,
      resourcesPath: path.join(root, 'resources'),
      packaged: false,
      userDataDir: userData,
      onLocalStatusChange: (status) => states.push(status.state)
    })
    llm.configure(LOCAL)
    expect(await llm.corrector.warmup()).toBe(false)

    const status = await llm.status(LOCAL)
    expect(status.local.state).toBe('failed')
    expect(status.local.error).toBeDefined()
    expect(status.message).toContain('未能运行')
    // The settings panel learns about the transition through this callback.
    expect(states).toContain('starting')
    expect(states).toContain('failed')
    await llm.dispose(true)
  })

  it('reports endpoint configuration without exposing a key', async () => {
    const { root, userData } = makeRoot()
    const llm = await manager(root, userData)
    const status = await llm.status({
      backend: 'endpoint',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:1.5b'
    })
    expect(status.endpoint).toEqual({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:1.5b',
      hasKey: false
    })
    expect(status.message).toContain('API Key')
    await llm.dispose(true)
  })
})
