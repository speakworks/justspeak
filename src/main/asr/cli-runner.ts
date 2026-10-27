import { randomUUID } from 'node:crypto'
import { spawn as nodeSpawn } from 'node:child_process'
import { access, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
  AudioInput,
  ProviderHealth,
  ProviderResult,
  TranscribeOptions
} from '../../core/asr/types'
import type { Qwen3Runner, Qwen3RunnerResult } from '../../core/asr/qwen3-provider'
import { encodeWav } from '../../core/asr/wav'

const MAX_CAPTURE_BYTES = 256 * 1024
const DEFAULT_TIMEOUT_MS = 120_000

export interface ChildStreamPort {
  on(event: 'data', listener: (chunk: Buffer | string) => void): void
}

export interface ChildProcessPort {
  stdout: ChildStreamPort | null
  stderr: ChildStreamPort | null
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'close', listener: (code: number | null, signal: string | null) => void): void
  kill(signal?: NodeJS.Signals): boolean
}

export interface CliRunnerDeps {
  spawn: (command: string, args: string[]) => ChildProcessPort
  writeFile: (file: string, data: Uint8Array) => Promise<void>
  unlink: (file: string) => Promise<void>
  makeTempPath: () => string
  access: (file: string, mode: number) => Promise<void>
  now: () => number
}

export interface TranscribeCliRunnerConfig {
  cliPath: string
  modelPath: string
  defaultTimeoutMs?: number
  deps?: Partial<CliRunnerDeps>
}

export interface ParsedCliOutput {
  text: string
  language?: string
}

/**
 * Parse the stable lines emitted by transcribe-cli. Library logs go to stderr;
 * the transcript and detected language are the last matching stdout lines.
 */
export function parseCliStdout(stdout: string): ProviderResult<ParsedCliOutput> {
  let text: string | undefined
  let language: string | undefined

  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('text:')) {
      const value = line.slice('text:'.length).replace(/^\s+/, '')
      // transcribe.cpp prints "(empty)" when the model detects no speech.
      text = value === '(empty)' ? '' : value
    } else if (line.startsWith('detected-language:')) {
      const value = line.slice('detected-language:'.length).trim()
      if (value) language = value
    }
  }

  if (text === undefined) {
    return {
      ok: false,
      error: {
        code: 'INFERENCE_FAILED',
        message: 'Transcription runtime produced no transcript line',
        retryable: true
      }
    }
  }
  return { ok: true, value: { text, language } }
}

/** Keep a diagnostic short and single-line so it can surface in the UI. */
function boundedDiagnostic(stderr: string, stdout: string): string {
  const combined = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' | ')
  if (!combined) return ''
  return combined.length > 300 ? `${combined.slice(0, 300)}…` : combined
}

function mapFailure(
  stderr: string,
  stdout: string,
  exitCode: number | null,
  cliPath?: string,
  modelPath?: string
): ProviderResult<never> {
  const text = `${stderr}\n${stdout}`.toLowerCase()
  const diagnostic = boundedDiagnostic(stderr, stdout)
  const detail = diagnostic ? ` Diagnostic: ${diagnostic}` : ''
  if (
    text.includes('file not found') ||
    text.includes('no such file') ||
    text.includes('failed to open model')
  ) {
    return {
      ok: false,
      error: {
        code: 'MODEL_MISSING',
        message:
          `Qwen3 model or runtime file is missing; run pnpm setup:asr.` +
          ` Runtime: ${cliPath ?? 'unknown'}; model: ${modelPath ?? 'unknown'}.` +
          detail,
        // ADR-0003: MODEL_MISSING is a repair case, not a retry case. Retrying
        // cannot make a missing file appear.
        retryable: false
      }
    }
  }
  if (text.includes('failed to load') || text.includes('model load')) {
    return {
      ok: false,
      error: {
        code: 'MODEL_LOAD_FAILED',
        message: `Qwen3 model failed to load; verify the SHA-256 and runtime build.${detail}`,
        retryable: false
      }
    }
  }
  return {
    ok: false,
    error: {
      code: 'INFERENCE_FAILED',
      message:
        `Transcription runtime exited with code ${exitCode ?? 'unknown'}.${detail}`,
      retryable: true
    }
  }
}

export class TranscribeCliRunner implements Qwen3Runner {
  private readonly cliPath: string
  private readonly modelPath: string
  private readonly defaultTimeoutMs: number
  private readonly deps: CliRunnerDeps

  constructor(config: TranscribeCliRunnerConfig) {
    this.cliPath = config.cliPath
    this.modelPath = config.modelPath
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.deps = {
      spawn: (command, args) => nodeSpawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }),
      writeFile,
      unlink,
      makeTempPath: () => path.join(tmpdir(), `justspeak-${randomUUID()}.wav`),
      access,
      now: () => Date.now(),
      ...config.deps
    }
  }

  async run(
    input: AudioInput,
    options: TranscribeOptions
  ): Promise<ProviderResult<Qwen3RunnerResult>> {
    if (options.signal?.aborted) {
      return {
        ok: false,
        error: { code: 'CANCELLED', message: 'Transcription cancelled', retryable: false }
      }
    }

    const wavPath = this.deps.makeTempPath()
    await this.deps.writeFile(wavPath, encodeWav(input.pcm))

    return new Promise<ProviderResult<Qwen3RunnerResult>>((resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      let timedOut = false
      let cancelled = false
      let timeout: ReturnType<typeof setTimeout> | undefined

      const child = this.deps.spawn(this.cliPath, ['-q', '-m', this.modelPath, wavPath])

      const settle = (result: ProviderResult<Qwen3RunnerResult>): void => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        options.signal?.removeEventListener('abort', onAbort)
        void this.deps.unlink(wavPath).catch(() => {})
        resolve(result)
      }

      const onAbort = (): void => {
        cancelled = true
        child.kill('SIGKILL')
      }

      child.stdout?.on('data', (chunk) => {
        if (stdout.length < MAX_CAPTURE_BYTES) stdout += String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        if (stderr.length < MAX_CAPTURE_BYTES) stderr += String(chunk)
      })
      child.on('error', (error) => {
        settle({
          ok: false,
          error: {
            code: 'MODEL_LOAD_FAILED',
            message: `Failed to start transcription runtime: ${error.message}`,
            retryable: false,
            cause: error
          }
        })
      })
      child.on('close', (code) => {
        if (cancelled) {
          settle({
            ok: false,
            error: { code: 'CANCELLED', message: 'Transcription cancelled', retryable: false }
          })
          return
        }
        if (timedOut) {
          settle({
            ok: false,
            error: {
              code: 'TIMEOUT',
              message: `Transcription exceeded ${this.defaultTimeoutMs} ms`,
              retryable: true
            }
          })
          return
        }
        if (code !== 0) {
          settle(mapFailure(stderr, stdout, code, this.cliPath, this.modelPath))
          return
        }
        const parsed = parseCliStdout(stdout)
        if (!parsed.ok) {
          settle(parsed)
          return
        }
        settle({ ok: true, value: { text: parsed.value.text, language: parsed.value.language } })
      })

      timeout = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, options.timeoutMs ?? this.defaultTimeoutMs)
      timeout.unref?.()
      options.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  async health(): Promise<ProviderHealth> {
    try {
      await this.deps.access(this.cliPath, constants.X_OK)
      await this.deps.access(this.modelPath, constants.R_OK)
      return { status: 'ready', modelId: 'qwen3-asr-0.6b-q8' }
    } catch (error) {
      return {
        status: 'error',
        modelId: 'qwen3-asr-0.6b-q8',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async dispose(): Promise<void> {}
}
