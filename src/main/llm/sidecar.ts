import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import {
  buildDecisionPrompt,
  decisionOrFallback,
  type CorrectionAction
} from '../../core/llm/decision'

/**
 * Technical spike for the LLM sidecar. It is intentionally not wired into the
 * app: no settings, no IPC, no default behavior. `scripts/llm-probe.ts` starts
 * it, measures it, and stops it.
 *
 * `llama-server` is kept as a child process so a model crash cannot take the
 * Electron main process down, and so the runtime can be signed and replaced
 * independently, matching the existing transcribe-cli sidecar.
 */
export interface LlamaSidecarOptions {
  binaryPath: string
  modelPath: string
  startupTimeoutMs?: number
  contextSize?: number
  threads?: number
  onLog?: (line: string) => void
}

export interface DecisionResult {
  action: CorrectionAction
  latencyMs: number
  raw: string
  timedOut: boolean
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      server.close(() => resolve(port))
    })
  })
}

export class LlamaSidecar {
  private readonly options: Required<Pick<LlamaSidecarOptions, 'startupTimeoutMs' | 'contextSize' | 'threads'>> &
    LlamaSidecarOptions
  private child?: ChildProcess
  private port?: number
  private stderrTail = ''
  private stopped = false
  private exited = false
  private spawnError?: Error
  private starting?: Promise<void>
  private stopping?: Promise<void>
  private generation = 0

  constructor(options: LlamaSidecarOptions) {
    this.options = {
      startupTimeoutMs: 30_000,
      contextSize: 2048,
      threads: Math.max(2, Math.min(8, os.cpus().length)),
      ...options
    }
  }

  get pid(): number | undefined {
    return this.child?.pid
  }

  get baseUrl(): string | undefined {
    return this.port === undefined ? undefined : `http://127.0.0.1:${this.port}`
  }

  get threads(): number {
    return this.options.threads
  }

  /**
   * Memoize the in-flight start so two concurrent callers cannot spawn two
   * servers. A failed start is cleaned up before the promise rejects, so a
   * later retry (for example after installing a missing binary) starts fresh.
   */
  async start(): Promise<void> {
    // A stop in flight must finish before a new child is spawned; otherwise
    // the old child's exit can clobber the new instance's state.
    if (this.stopping) await this.stopping
    if (this.starting) return this.starting
    this.starting = this.startInternal()
    try {
      await this.starting
    } finally {
      this.starting = undefined
    }
  }

  private async startInternal(): Promise<void> {
    if (this.child) return
    this.stopped = false
    this.exited = false
    this.spawnError = undefined
    this.stderrTail = ''
    const generation = ++this.generation
    this.port = await freePort()
    // A stop may land while the port is being selected; do not spawn behind it.
    if (this.stopped || generation !== this.generation) {
      throw new Error('sidecar start cancelled by stop')
    }

    const args = [
      '-m',
      this.options.modelPath,
      '--host',
      '127.0.0.1',
      '--port',
      String(this.port),
      '-c',
      String(this.options.contextSize),
      '-n',
      '32',
      '--threads',
      String(this.options.threads),
      '--parallel',
      '1',
      '--no-webui'
    ]
    this.options.onLog?.(`starting ${this.options.binaryPath} ${args.join(' ')}`)
    const child = spawn(this.options.binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child
    child.once('error', (error) => {
      this.spawnError = error
      this.options.onLog?.(`sidecar spawn error: ${error.message}`)
    })
    child.stdout?.on('data', (chunk: Buffer) => this.options.onLog?.(chunk.toString().trimEnd()))
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      this.stderrTail = `${this.stderrTail}${text}`.slice(-4000)
      this.options.onLog?.(text.trimEnd())
    })
    child.once('exit', (code, signal) => {
      // Ignore a stale child: a stop may overlap a new start.
      if (this.child !== child) return
      this.exited = true
      this.child = undefined
      if (!this.stopped) this.options.onLog?.(`sidecar exited: code=${code} signal=${signal}`)
    })

    try {
      await this.waitForHealth()
    } catch (error) {
      // A failed start must not leave a live ~1 GB process behind, and a retry
      // must be able to spawn a fresh one.
      await this.stop()
      throw error
    }
  }

  private async waitForHealth(): Promise<void> {
    const deadline = Date.now() + this.options.startupTimeoutMs
    while (Date.now() < deadline) {
      if (this.spawnError) throw this.spawnError
      if (!this.child || this.exited) {
        throw new Error(`llama-server exited during startup: ${this.stderrTail.slice(-800)}`)
      }
      try {
        const remaining = Math.max(1, deadline - Date.now())
        const response = await fetch(`${this.baseUrl}/health`, {
          signal: AbortSignal.timeout(Math.min(1000, remaining))
        })
        if (response.ok) return
      } catch {
        // Not listening yet, or the probe timed out; keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error(
      `llama-server did not become healthy within ${this.options.startupTimeoutMs}ms: ${this.stderrTail.slice(-800)}`
    )
  }

  async decide(text: string, timeoutMs = 800): Promise<DecisionResult> {
    if (!this.baseUrl) throw new Error('sidecar is not started')
    const prompt = buildDecisionPrompt(text)
    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'local',
          temperature: 0,
          max_tokens: 32,
          stream: false,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
          ]
        })
      })
      if (!response.ok) {
        throw new Error(`llama-server returned HTTP ${response.status}`)
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>
      }
      const raw = payload.choices?.[0]?.message?.content
      const content = typeof raw === 'string' ? raw : ''
      return {
        action: decisionOrFallback(content),
        latencyMs: Date.now() - started,
        raw: content,
        timedOut: false
      }
    } catch (error) {
      const timedOut = controller.signal.aborted
      return {
        action: 'defer_to_human',
        latencyMs: Date.now() - started,
        raw: timedOut ? 'timeout' : error instanceof Error ? error.message : String(error),
        timedOut
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping
    this.stopping = this.stopInternal()
    try {
      await this.stopping
    } finally {
      this.stopping = undefined
    }
  }

  private async stopInternal(): Promise<void> {
    this.stopped = true
    this.generation += 1
    const child = this.child
    this.child = undefined
    this.port = undefined
    // A failed spawn may have no pid and no exit event; there is nothing to
    // signal or wait for.
    if (
      !child ||
      child.pid === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      return
    }

    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        finish()
      }, 3000)
      child.once('exit', finish)
      if (child.exitCode !== null || child.signalCode !== null) finish()
    })
  }
}
