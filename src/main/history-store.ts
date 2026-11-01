import { randomUUID } from 'node:crypto'
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'
import { encodeWav } from '../core/asr/wav'
import {
  parseHistory,
  planHistoryRetention,
  removeHistoryEntry,
  serializeHistoryEntry
} from '../core/history'
import type {
  HistoryAudioRef,
  HistoryEntry,
  HistoryOutcome,
  TranscriptEvent
} from '../shared/ipc'

export interface HistoryStoreDeps {
  readFile: typeof readFile
  writeFile: typeof writeFile
  mkdir: typeof mkdir
  appendFile: typeof appendFile
  rename: typeof rename
  unlink: typeof unlink
  readdir: typeof readdir
  now: () => number
  newId: () => string
}

const DEFAULT_DEPS: HistoryStoreDeps = {
  readFile,
  writeFile,
  mkdir,
  appendFile,
  rename,
  unlink,
  readdir,
  now: Date.now,
  newId: () => randomUUID()
}

export const HISTORY_DIR = 'history'
export const HISTORY_FILE = 'entries.jsonl'
export const AUDIO_DIR = 'audio'

/** The raw capture for one entry; kept as PCM so the WAV needs no transcode. */
export interface HistoryAudioClip {
  pcm: Int16Array
  sampleRate: number
}

/**
 * Append-only transcript history under `userData/history/`, with one WAV per
 * entry under `audio/`.
 *
 * Dictation must never fail because history could not be written, so callers
 * treat every rejection here as a warning. Appends and removals share one
 * promise queue: a removal or retention rewrite would otherwise race an
 * append and lose it.
 */
export class HistoryStore {
  readonly dir: string
  readonly file: string
  readonly audioDir: string
  private readonly deps: HistoryStoreDeps
  private queue: Promise<void> = Promise.resolve()

  constructor(userDataDir: string, deps: HistoryStoreDeps = DEFAULT_DEPS) {
    this.dir = path.join(userDataDir, HISTORY_DIR)
    this.file = path.join(this.dir, HISTORY_FILE)
    this.audioDir = path.join(this.dir, AUDIO_DIR)
    this.deps = deps
  }

  /** Newest first; a missing file is an empty history, not an error. */
  async list(): Promise<HistoryEntry[]> {
    return this.enqueue(() => this.readAll())
  }

  /**
   * Record one finished transcript and its audio. A failed audio write keeps
   * the text row: losing the sound is better than losing the words.
   */
  async append(
    event: TranscriptEvent,
    outcome: HistoryOutcome,
    audio?: HistoryAudioClip
  ): Promise<HistoryEntry> {
    const entry: HistoryEntry = {
      id: this.deps.newId(),
      text: event.text,
      createdAt: this.deps.now(),
      outcome,
      fake: event.fake,
      durationMs: event.durationMs,
      latencyMs: event.latencyMs
    }

    await this.enqueue(async () => {
      await this.deps.mkdir(this.dir, { recursive: true })
      if (audio && audio.pcm.length > 0) {
        try {
          await this.deps.mkdir(this.audioDir, { recursive: true })
          const bytes = encodeWav(audio.pcm, audio.sampleRate)
          const file = `${AUDIO_DIR}/${entry.id}.wav`
          await this.deps.writeFile(path.join(this.dir, file), bytes)
          entry.audio = { file, bytes: bytes.byteLength }
        } catch (error) {
          console.warn('[history] could not save the recording; keeping the text', error)
        }
      }
      await this.deps.appendFile(this.file, serializeHistoryEntry(entry), 'utf8')
      try {
        // Retention, plus the orphan sweep the spec requires after each append.
        await this.applyRetentionLocked(this.deps.now(), true)
      } catch (error) {
        console.warn('[history] retention pass failed', error)
      }
    })

    return entry
  }

  /** Remove one entry and its audio; returns the surviving list, newest first. */
  async remove(id: string): Promise<HistoryEntry[]> {
    return this.enqueue(async () => {
      const entries = await this.readAll()
      const target = entries.find((entry) => entry.id === id)
      if (target === undefined) return entries
      // Audio first (the spec's order). If the rewrite then fails, the row
      // survives with no playable audio; the reverse order would leave a file
      // that no row references and only a startup sweep could reclaim.
      await this.deleteAudioFiles([target.audio])
      const kept = removeHistoryEntry(entries, id)
      await this.writeAll(kept)
      return kept
    })
  }

  /**
   * Apply the retention limits now. Called once at startup and after every
   * append; the append path tolerates a failure here.
   */
  async sweep(now = this.deps.now()): Promise<void> {
    await this.enqueue(() => this.applyRetentionLocked(now, true))
  }

  /** Wait for every queued mutation; used before the process exits. */
  async flush(): Promise<void> {
    await this.enqueue(async () => {})
  }

  /** The WAV bytes for one entry, or null when it has no audio any more. */
  async readAudio(id: string): Promise<ArrayBuffer | null> {
    return this.enqueue(async () => {
      const entries = await this.readAll()
      const entry = entries.find((value) => value.id === id)
      if (entry?.audio === undefined) return null
      const target = this.audioPath(entry.audio.file)
      if (target === null) return null
      try {
        const bytes = await this.deps.readFile(target)
        return new Uint8Array(bytes).buffer
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') console.warn('[history] could not read audio', error)
        return null
      }
    })
  }

  private async applyRetentionLocked(now = this.deps.now(), cleanOrphans = false): Promise<void> {
    const entries = await this.readAll()
    const plan = planHistoryRetention(entries, now)
    if (plan.removed.length === 0 && plan.audioDropped.length === 0) {
      // Startup still sweeps files an interrupted removal left unreferenced.
      if (cleanOrphans) await this.deleteOrphanAudio(entries)
      return
    }

    // Delete sound before rewriting rows (the spec's order). A crash between
    // the two leaves rows pointing at missing audio; `readAudio` reports no
    // audio and the next sweep finishes the rewrite.
    await this.deleteAudioFiles([
      ...plan.removed.map((entry) => entry.audio),
      ...plan.audioDropped
    ])
    await this.writeAll(plan.kept)
    await this.deleteOrphanAudio(plan.kept)
  }

  private async readAll(): Promise<HistoryEntry[]> {
    let raw: string
    try {
      raw = await this.deps.readFile(this.file, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return []
      // Anything else (EACCES, EIO, EISDIR…) must reach the pane as a failure.
      // Reporting it as an empty history is exactly the "my words vanished"
      // misreading this feature exists to prevent.
      throw error
    }

    const { entries, skipped } = parseHistory(raw)
    if (skipped > 0) console.warn(`[history] skipped ${skipped} unusable line(s)`)
    return entries.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Rewrite through a temp file so an interrupted write cannot truncate history. */
  private async writeAll(entries: readonly HistoryEntry[]): Promise<void> {
    await this.deps.mkdir(this.dir, { recursive: true })
    // The single-instance lock makes one writer the norm; the pid keeps even a
    // stray second process from colliding on the same temp file.
    const temp = `${this.file}.${process.pid}.tmp`
    const body = entries.map(serializeHistoryEntry).join('')
    await this.deps.writeFile(temp, body, 'utf8')
    await this.deps.rename(temp, this.file)
  }

  /** Best effort: an unreadable or already-missing file never aborts cleanup. */
  private async deleteAudioFiles(refs: ReadonlyArray<HistoryAudioRef | undefined>): Promise<void> {
    for (const ref of refs) {
      if (ref === undefined) continue
      const target = this.audioPath(ref.file)
      if (target === null) {
        console.warn('[history] refusing a path outside the history directory', ref.file)
        continue
      }
      try {
        await this.deps.unlink(target)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') console.warn('[history] could not delete audio', error)
      }
    }
  }

  /** Remove WAVs no surviving entry references (a crash left them behind). */
  private async deleteOrphanAudio(entries: readonly HistoryEntry[]): Promise<void> {
    await this.deleteStaleTemps()
    const referenced = new Set(
      entries.flatMap((entry) =>
        entry.audio === undefined ? [] : [path.basename(entry.audio.file)]
      )
    )
    let names: string[]
    try {
      names = await this.deps.readdir(this.audioDir)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') console.warn('[history] could not list audio', error)
      return
    }
    for (const name of names) {
      if (!name.endsWith('.wav') || referenced.has(name)) continue
      try {
        await this.deps.unlink(path.join(this.audioDir, name))
      } catch (error) {
        console.warn('[history] could not delete orphan audio', error)
      }
    }
  }

  /** Remove rewrite temp files left by a crash; the queue guarantees none is live. */
  private async deleteStaleTemps(): Promise<void> {
    let names: string[]
    try {
      names = await this.deps.readdir(this.dir)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') console.warn('[history] could not list temp files', error)
      return
    }
    for (const name of names) {
      if (!name.startsWith(`${HISTORY_FILE}.`) || !name.endsWith('.tmp')) continue
      try {
        await this.deps.unlink(path.join(this.dir, name))
      } catch (error) {
        console.warn('[history] could not delete a stale temp file', error)
      }
    }
  }

  /** Resolve a stored relative path, refusing anything outside `history/`. */
  private audioPath(file: string): string | null {
    const root = path.resolve(this.dir)
    const target = path.resolve(root, file)
    return target.startsWith(`${root}${path.sep}`) ? target : null
  }

  /**
   * Serialise file mutations. `then(run, run)` keeps the chain alive after a
   * failure so one bad write does not block every later one.
   */
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run)
    this.queue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }
}
