import { spawn as nodeSpawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseCliStdout,
  TranscribeCliRunner,
  type ChildProcessPort,
  type CliRunnerDeps
} from '../src/main/asr/cli-runner'
import { pcmInput } from './provider-contract'

const GOLDEN = readFileSync(
  fileURLToPath(new URL('./fixtures/transcribe-cli-stdout.txt', import.meta.url)),
  'utf8'
)

let dir: string
let tempCounter = 0

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'justspeak-cli-test-'))
  tempCounter = 0
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function nodeScript(script: string, onSpawn?: (args: string[]) => void): CliRunnerDeps['spawn'] {
  return (_command, args) => {
    onSpawn?.(args)
    return nodeSpawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe']
    }) as unknown as ChildProcessPort
  }
}

function makeRunner(overrides: Partial<CliRunnerDeps> = {}): {
  runner: TranscribeCliRunner
  unlinked: string[]
} {
  const unlinked: string[] = []
  const runner = new TranscribeCliRunner({
    cliPath: '/fake/transcribe-cli',
    modelPath: '/fake/model.gguf',
    defaultTimeoutMs: 5000,
    deps: {
      makeTempPath: () => path.join(dir, `utterance-${tempCounter++}.wav`),
      unlink: async (file) => {
        unlinked.push(file)
        const { unlink } = await import('node:fs/promises')
        await unlink(file).catch(() => {})
      },
      ...overrides
    }
  })
  return { runner, unlinked }
}

describe('transcribe-cli stdout parser', () => {
  it('parses the golden output captured from the pinned CLI', () => {
    const parsed = parseCliStdout(GOLDEN)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.text).toBe('这是语音识别测试。今天天气很好。')
      expect(parsed.value.language).toBe('zh')
    }
  })

  it('maps the pinned CLI silence sentinel to empty text', () => {
    const parsed = parseCliStdout('run: ok\ntext: (empty)\n')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.text).toBe('')
  })

  it('supports an empty transcript line', () => {
    const parsed = parseCliStdout('run: ok\ntext: \ndetected-language: zh\n')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.text).toBe('')
  })

  it('fails when no transcript line is present', () => {
    const parsed = parseCliStdout('run: ok\n')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error.code).toBe('INFERENCE_FAILED')
  })
})

describe('transcribe-cli runner', () => {
  it('writes a WAV, parses a real child transcript, and cleans up', async () => {
    let wavBytes: Buffer | undefined
    let spawnedArgs: string[] = []
    const { runner, unlinked } = makeRunner({
      spawn: nodeScript(
        "process.stdout.write('run: ok\\ntext: hello world\\ndetected-language: en\\n')",
        (args) => {
          spawnedArgs = args
          wavBytes = readFileSync(args.at(-1) as string)
        }
      )
    })

    const result = await runner.run(pcmInput(320), {})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.text).toBe('hello world')
      expect(result.value.language).toBe('en')
    }
    expect(spawnedArgs.slice(0, 3)).toEqual(['-q', '-m', '/fake/model.gguf'])
    expect(wavBytes?.subarray(0, 4).toString()).toBe('RIFF')
    expect(unlinked).toHaveLength(1)
  })

  it('maps a missing model message to MODEL_MISSING', async () => {
    const { runner } = makeRunner({
      spawn: nodeScript("process.stderr.write('model: /x -> file not found\\n'); process.exit(1)")
    })
    const result = await runner.run(pcmInput(), {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('MODEL_MISSING')
  })

  it('maps other non-zero exits to INFERENCE_FAILED', async () => {
    const { runner } = makeRunner({
      spawn: nodeScript("process.stderr.write('boom\\n'); process.exit(2)")
    })
    const result = await runner.run(pcmInput(), {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INFERENCE_FAILED')
      expect(result.error.retryable).toBe(true)
    }
  })

  it('maps a missing transcript to INFERENCE_FAILED', async () => {
    const { runner, unlinked } = makeRunner({
      spawn: nodeScript("process.stdout.write('run: ok\\n')")
    })
    const result = await runner.run(pcmInput(), {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INFERENCE_FAILED')
    expect(unlinked).toHaveLength(1)
  })

  it('kills the child and returns TIMEOUT', async () => {
    const { runner, unlinked } = makeRunner({
      spawn: nodeScript('setTimeout(() => {}, 60000)')
    })
    const result = await runner.run(pcmInput(), { timeoutMs: 50 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TIMEOUT')
    expect(unlinked).toHaveLength(1)
  })

  it('kills the child and returns CANCELLED', async () => {
    const { runner, unlinked } = makeRunner({
      spawn: nodeScript('setTimeout(() => {}, 60000)')
    })
    const controller = new AbortController()
    const pending = runner.run(pcmInput(), { signal: controller.signal })
    setTimeout(() => controller.abort(), 20)
    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CANCELLED')
    expect(unlinked).toHaveLength(1)
  })

  it('maps a spawn error to MODEL_LOAD_FAILED', async () => {
    class FakeChild implements ChildProcessPort {
      stdout = null
      stderr = null
      on(event: 'error', listener: (error: Error) => void): void
      on(event: 'close', listener: (code: number | null, signal: string | null) => void): void
      on(
        event: 'error' | 'close',
        listener: ((error: Error) => void) | ((code: number | null, signal: string | null) => void)
      ): void {
        if (event === 'error') {
          queueMicrotask(() => (listener as (error: Error) => void)(new Error('ENOENT')))
        }
      }
      kill(): boolean {
        return true
      }
    }
    const { runner } = makeRunner({ spawn: () => new FakeChild() })
    const result = await runner.run(pcmInput(), {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('MODEL_LOAD_FAILED')
  })

  it('reports health from the runtime and model files', async () => {
    const ready = makeRunner({ access: async () => {} }).runner
    expect((await ready.health()).status).toBe('ready')

    const missing = makeRunner({
      access: async () => {
        throw new Error('missing')
      }
    }).runner
    const health = await missing.health()
    expect(health.status).toBe('error')
    expect(health.message).toContain('missing')
  })

  it('does not spawn when already cancelled', async () => {
    const spawn = vi.fn() as unknown as CliRunnerDeps['spawn']
    const { runner, unlinked } = makeRunner({ spawn })
    const controller = new AbortController()
    controller.abort()
    const result = await runner.run(pcmInput(), { signal: controller.signal })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CANCELLED')
    expect(spawn).not.toHaveBeenCalled()
    expect(unlinked).toHaveLength(0)
  })
})
