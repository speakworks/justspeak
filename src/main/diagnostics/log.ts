import { constants } from 'node:fs'
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { format } from 'node:util'
import { redactDiagnosticText, type RedactionPaths } from '../../core/diagnostics/redact'

export interface DiagnosticsLogDeps {
  appendFile: typeof appendFile
  mkdir: typeof mkdir
  rename: typeof rename
  rm: typeof rm
  stat: typeof stat
}

export interface DiagnosticsLogOptions {
  file: string
  /** Rotate before a line would push the active file past this size. */
  maxBytes?: number
  backups?: number
  redaction?: RedactionPaths
}

const DEFAULT_DEPS: DiagnosticsLogDeps = { appendFile, mkdir, rename, rm, stat }

/**
 * A tiny, non-blocking main-process log. Dictation must never fail because the
 * disk is full or a log line is malformed, so every filesystem error is
 * swallowed and writes are serialized.
 */
export class DiagnosticsLog {
  private readonly deps: DiagnosticsLogDeps
  private readonly file: string
  private readonly maxBytes: number
  private readonly backups: number
  private readonly redaction: RedactionPaths
  private queue: Promise<void> = Promise.resolve()
  private size = 0
  private sizeKnown = false
  private teardown?: () => void

  constructor(options: DiagnosticsLogOptions, deps: DiagnosticsLogDeps = DEFAULT_DEPS) {
    this.deps = deps
    this.file = options.file
    this.maxBytes = options.maxBytes ?? 1_000_000
    this.backups = options.backups ?? 2
    this.redaction = options.redaction ?? {}
  }

  write(level: string, ...args: unknown[]): void {
    let message: string
    try {
      message = redactDiagnosticText(format(...args), this.redaction)
    } catch {
      return
    }
    const line = `${new Date().toISOString()} [${level}] ${message}\n`
    this.queue = this.queue.then(() => this.append(line)).catch(() => undefined)
  }

  private async append(line: string): Promise<void> {
    const bytes = Buffer.byteLength(line, 'utf8')
    if (!this.sizeKnown) {
      try {
        this.size = (await this.deps.stat(this.file)).size
      } catch {
        this.size = 0
      }
      this.sizeKnown = true
    }
    if (this.size > 0 && this.size + bytes > this.maxBytes) await this.rotate()
    await this.deps.mkdir(path.dirname(this.file), { recursive: true })
    // O_NOFOLLOW: a symlink planted at the predictable log path must not turn
    // into a write into another local file.
    await this.deps.appendFile(this.file, line, {
      encoding: 'utf8',
      flag:
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_WRONLY |
        constants.O_NOFOLLOW
    })
    this.size += bytes
  }

  private async renameIfExists(from: string, to: string): Promise<void> {
    try {
      await this.deps.rename(from, to)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private async rotate(): Promise<void> {
    for (let index = this.backups; index >= 1; index -= 1) {
      const current = `${this.file}.${index}`
      if (index === this.backups) {
        await this.deps.rm(current, { force: true })
      } else {
        await this.renameIfExists(current, `${this.file}.${index + 1}`)
      }
    }
    await this.deps.rename(this.file, `${this.file}.1`)
    this.size = 0
  }

  /** Resolve after every queued line is written. Never rejects. */
  flush(): Promise<void> {
    return this.queue
  }

  /**
   * Mirror console output to the log while keeping terminal output. Returns a
   * restore function for tests and shutdown.
   */
  installConsoleTee(): () => void {
    if (this.teardown) return this.teardown
    const original = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console)
    }
    type Level = keyof typeof original
    const levels: Level[] = ['log', 'info', 'warn', 'error', 'debug']
    for (const level of levels) {
      console[level] = (...args: unknown[]): void => {
        original[level](...args)
        this.write(level, ...args)
      }
    }
    this.teardown = () => {
      for (const level of levels) console[level] = original[level]
      this.teardown = undefined
    }
    return this.teardown
  }
}
