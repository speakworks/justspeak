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

  it('appends one ordered --vocabulary argument after the existing arguments', async () => {
    let spawnedArgs: string[] = []
    const { runner, unlinked } = makeRunner({
      spawn: nodeScript("process.stdout.write('text: hello\\n')", (args) => {
        spawnedArgs = args
      })
    })

    const result = await runner.run(pcmInput(320), {
      vocabulary: ['Kubernetes', 'GPT-4o', '张三']
    })
    expect(result.ok).toBe(true)
    expect(spawnedArgs.slice(0, 4)).toEqual([
      '-q',
      '-m',
      '/fake/model.gguf',
      path.join(dir, 'utterance-0.wav')
    ])
    expect(spawnedArgs.slice(4)).toEqual(['--vocabulary', 'Kubernetes,GPT-4o,张三'])
    expect(unlinked).toHaveLength(1)
  })

  it('leaves the invocation byte-for-byte unchanged when no terms are accepted', async () => {
    let spawnedArgs: string[] = []
    const { runner } = makeRunner({
      spawn: nodeScript("process.stdout.write('text: hello\\n')", (args) => {
        spawnedArgs = args
      })
    })

    const result = await runner.run(pcmInput(), { vocabulary: [] })
    expect(result.ok).toBe(true)
    expect(spawnedArgs).toEqual([
      '-q',
      '-m',
      '/fake/model.gguf',
      path.join(dir, 'utterance-0.wav')
    ])
  })

  it('retries once without --vocabulary when the CLI rejects the option', async () => {
    const spawned: string[][] = []
    const spawn: CliRunnerDeps['spawn'] = (_command, args) => {
      spawned.push(args)
      const script = args.includes('--vocabulary')
        ? "process.stderr.write(\"error: unknown option '--vocabulary'\\n\"); process.exit(1)"
        : "process.stdout.write('text: unbiased\\n')"
      return nodeSpawn(process.execPath, ['-e', script], {
        stdio: ['ignore', 'pipe', 'pipe']
      }) as unknown as ChildProcessPort
    }
    const { runner, unlinked } = makeRunner({ spawn })

    const result = await runner.run(pcmInput(), { vocabulary: ['Kubernetes'] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.text).toBe('unbiased')
      expect(result.value.warnings?.map((warning) => warning.code)).toContain(
        'VOCABULARY_UNSUPPORTED'
      )
    }
    expect(spawned).toHaveLength(2)
    expect(spawned[0]).toContain('--vocabulary')
    expect(spawned[1]).not.toContain('--vocabulary')
    expect(unlinked).toHaveLength(1)
  })

  it('does not retry when the retry also fails', async () => {
    const spawned: string[][] = []
    const spawn: CliRunnerDeps['spawn'] = (_command, args) => {
      spawned.push(args)
      const script = args.includes('--vocabulary')
        ? "process.stderr.write(\"error: unknown option '--vocabulary'\\n\"); process.exit(1)"
        : "process.stderr.write('boom\\n'); process.exit(2)"
      return nodeSpawn(process.execPath, ['-e', script], {
        stdio: ['ignore', 'pipe', 'pipe']
      }) as unknown as ChildProcessPort
    }
    const { runner, unlinked } = makeRunner({ spawn })

    const result = await runner.run(pcmInput(), { vocabulary: ['Kubernetes'] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INFERENCE_FAILED')
    expect(spawned).toHaveLength(2)
    expect(unlinked).toHaveLength(1)
  })

  it('does not retry an unrelated inference failure', async () => {
    const spawned: string[][] = []
    const spawn: CliRunnerDeps['spawn'] = (_command, args) => {
      spawned.push(args)
      return nodeSpawn(
        process.execPath,
        ['-e', "process.stderr.write('boom\\n'); process.exit(2)"],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      ) as unknown as ChildProcessPort
    }
    const { runner } = makeRunner({ spawn })

    const result = await runner.run(pcmInput(), { vocabulary: ['Kubernetes'] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INFERENCE_FAILED')
    expect(spawned).toHaveLength(1)
  })

  it('does not retry an unrelated unknown option even when the usage names --vocabulary', async () => {
    // A parse failure prints the whole usage, and that usage always contains
    // `--vocabulary TERMS`. Only a same-line binding may trigger the retry.
    const spawned: string[][] = []
    const spawn: CliRunnerDeps['spawn'] = (_command, args) => {
      spawned.push(args)
      return nodeSpawn(
        process.execPath,
        [
          '-e',
          "process.stderr.write(\"error: unknown option '-q'\\n" +
            "Usage: transcribe-cli [options]\\n" +
            '  --vocabulary TERMS  comma-separated terms\\n"); process.exit(1)'
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      ) as unknown as ChildProcessPort
    }
    const { runner } = makeRunner({ spawn })

    const result = await runner.run(pcmInput(), { vocabulary: ['Kubernetes'] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INFERENCE_FAILED')
    expect(spawned).toHaveLength(1)
  })

  it('retries when the unknown-option line itself names --vocabulary', async () => {
    const spawned: string[][] = []
    const spawn: CliRunnerDeps['spawn'] = (_command, args) => {
      spawned.push(args)
      const script = args.includes('--vocabulary')
        ? "process.stderr.write(\"error: unknown option '--vocabulary'\\n\"); process.exit(1)"
        : "process.stdout.write('text: unbiased\\n')"
      return nodeSpawn(process.execPath, ['-e', script], {
        stdio: ['ignore', 'pipe', 'pipe']
      }) as unknown as ChildProcessPort
    }
    const { runner } = makeRunner({ spawn })

    const result = await runner.run(pcmInput(), { vocabulary: ['Kubernetes'] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.text).toBe('unbiased')
    expect(spawned).toHaveLength(2)
  })

  it('detects a flag rejection from untruncated stderr past the 300-character summary', async () => {
    const noise = 'noise '.repeat(80)
    const spawned: string[][] = []
    const spawn: CliRunnerDeps['spawn'] = (_command, args) => {
      spawned.push(args)
      const script = args.includes('--vocabulary')
        ? `process.stderr.write(${JSON.stringify(
            `${noise}\nerror: unknown option '--vocabulary'\n`
          )}); process.exit(1)`
        : "process.stdout.write('text: unbounded\\n')"
      return nodeSpawn(process.execPath, ['-e', script], {
        stdio: ['ignore', 'pipe', 'pipe']
      }) as unknown as ChildProcessPort
    }
    const { runner } = makeRunner({ spawn })

    const result = await runner.run(pcmInput(), { vocabulary: ['Kubernetes'] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.text).toBe('unbounded')
    expect(spawned).toHaveLength(2)
  })

  it('returns CANCELLED without a retry when the signal aborts after the first failure', async () => {
    class ControlledChild implements ChildProcessPort {
      stdout = null
      stderr = {
        on: (_event: 'data', listener: (chunk: Buffer | string) => void): void => {
          this.stderrListener = listener
        }
      }
      private stderrListener?: (chunk: Buffer | string) => void
      private closeListener?: (code: number | null, signal: string | null) => void

      on(event: 'error', listener: (error: Error) => void): void
      on(event: 'close', listener: (code: number | null, signal: string | null) => void): void
      on(
        event: 'error' | 'close',
        listener: ((error: Error) => void) | ((code: number | null, signal: string | null) => void)
      ): void {
        if (event === 'close') {
          this.closeListener = listener as (code: number | null, signal: string | null) => void
        }
      }

      kill(): boolean {
        return true
      }

      writeStderr(text: string): void {
        this.stderrListener?.(text)
      }

      close(code: number): void {
        this.closeListener?.(code, null)
      }
    }

    let spawnCount = 0
    const controller = new AbortController()
    const spawn: CliRunnerDeps['spawn'] = () => {
      spawnCount += 1
      const child = new ControlledChild()
      queueMicrotask(() => {
        child.writeStderr("error: unknown option '--vocabulary'\n")
        child.close(1)
        // The first failure has settled; the abort lands before `run()` reads
        // the signal at the retry branch.
        controller.abort()
      })
      return child
    }
    const { runner } = makeRunner({ spawn })

    const result = await runner.run(pcmInput(), {
      vocabulary: ['Kubernetes'],
      signal: controller.signal
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CANCELLED')
    expect(spawnCount).toBe(1)
  })

  it('reports a recognised runtime truncation notice as VOCABULARY_TRUNCATED', async () => {
    const { runner } = makeRunner({
      spawn: nodeScript(
        "process.stdout.write('text: hello\\n');" +
          "process.stderr.write('WARN qwen3: dropped 2 of 10 vocabulary terms (prompt budget: 32 tokens)\\n')"
      )
    })

    const result = await runner.run(pcmInput(), { vocabulary: ['Kubernetes'] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.text).toBe('hello')
      expect(result.value.warnings?.map((warning) => warning.code)).toEqual([
        'VOCABULARY_TRUNCATED'
      ])
    }
  })

  it('invents no truncation warning when the runtime stays silent', async () => {
    const { runner } = makeRunner({
      spawn: nodeScript("process.stdout.write('text: hello\\n')")
    })

    const result = await runner.run(pcmInput(), { vocabulary: ['Kubernetes'] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.warnings).toEqual([])
  })

  it('maps a missing model message to MODEL_MISSING and cleans up', async () => {
    const { runner, unlinked } = makeRunner({
      spawn: nodeScript("process.stderr.write('model: /x -> file not found\\n'); process.exit(1)")
    })
    const result = await runner.run(pcmInput(), {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('MODEL_MISSING')
      // ADR-0003: a missing file is repaired, never retried.
      expect(result.error.retryable).toBe(false)
    }
    expect(unlinked).toHaveLength(1)
  })

  it('maps other non-zero exits to INFERENCE_FAILED and cleans up', async () => {
    const { runner, unlinked } = makeRunner({
      spawn: nodeScript("process.stderr.write('boom\\n'); process.exit(2)")
    })
    const result = await runner.run(pcmInput(), {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INFERENCE_FAILED')
      expect(result.error.retryable).toBe(true)
    }
    expect(unlinked).toHaveLength(1)
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
    const { runner, unlinked } = makeRunner({ spawn: () => new FakeChild() })
    const result = await runner.run(pcmInput(), {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('MODEL_LOAD_FAILED')
    expect(unlinked).toHaveLength(1)
  })

  it('unlinks the temp WAV when the write fails', async () => {
    const { runner, unlinked } = makeRunner({
      writeFile: async () => {
        throw new Error('ENOSPC')
      }
    })

    await expect(runner.run(pcmInput(), {})).rejects.toThrow('ENOSPC')
    expect(unlinked).toEqual([path.join(dir, 'utterance-0.wav')])
  })

  it('unlinks the temp WAV when spawn throws synchronously', async () => {
    const { runner, unlinked } = makeRunner({
      spawn: () => {
        throw new Error('spawn EPERM')
      }
    })

    await expect(runner.run(pcmInput(), {})).rejects.toThrow('spawn EPERM')
    expect(unlinked).toEqual([path.join(dir, 'utterance-0.wav')])
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
