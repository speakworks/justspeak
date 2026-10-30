import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parseHotkeyPreference } from '../core/hotkey/accelerator'
import {
  hasAcceptedChange,
  mergePreferences,
  type MergeResult,
  type StoredPreferences
} from '../core/preferences/merge'
import { parseThemePreference } from '../core/theme/theme'
import type { ThemePreference } from '../shared/ipc'

export interface ThemeStoreDeps {
  readFile: typeof readFile
  writeFile: typeof writeFile
  mkdir: typeof mkdir
}

export type { StoredPreferences } from '../core/preferences/merge'

const DEFAULT_DEPS: ThemeStoreDeps = { readFile, writeFile, mkdir }

/**
 * Persists preferences as one small JSON file under userData.
 * A missing or corrupt file resolves to defaults; it never throws, because a
 * preference read must not block startup. Writes merge into the existing
 * object so saving one key cannot drop another (or any future key).
 */
export class ThemeStore {
  private readonly file: string
  private readonly deps: ThemeStoreDeps
  /** Tail of the write chain; see `enqueue` for why writes must not interleave. */
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(userDataDir: string, deps: ThemeStoreDeps = DEFAULT_DEPS) {
    this.file = path.join(userDataDir, 'preferences.json')
    this.deps = deps
  }

  async load(): Promise<ThemePreference> {
    return (await this.loadPreferences()).theme
  }

  async loadPreferences(): Promise<StoredPreferences> {
    const record = await this.readRecord()
    return {
      theme: parseThemePreference(record.theme),
      hotkey: parseHotkeyPreference(record.hotkey)
    }
  }

  async save(theme: ThemePreference): Promise<void> {
    const result = await this.update({ theme })
    if (!result.ok) throw new Error(result.rejected[0]?.reason ?? '外观值无效。')
  }

  async saveHotkey(hotkey: string): Promise<void> {
    const result = await this.update({ hotkey })
    if (!result.ok) throw new Error(result.rejected[0]?.reason ?? '快捷键值无效。')
  }

  /**
   * Validate and atomically merge `patch` into the file.
   *
   * A rejected patch writes nothing. Accepted values are merged over the
   * freshest on-disk record, so a concurrent writer's keys survive.
   */
  async update(patch: unknown): Promise<MergeResult> {
    return this.enqueue(async () => {
      const existing = await this.readRecord()
      const result = mergePreferences(existing, patch)
      if (result.ok && hasAcceptedChange(result)) {
        await this.writeRecord(result.record)
      }
      return result
    })
  }

  /**
   * `theme`/`hotkey` writes are independent async handlers, so two saves can
   * otherwise both read the old object and then write only their own key,
   * dropping the other preference. Chaining every read-modify-write makes the
   * last writer observe the previous result.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(task)
    // A failed save must reject its own caller without poisoning the chain.
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private async writeRecord(record: Record<string, unknown>): Promise<void> {
    const payload = JSON.stringify(record, null, 2)
    await this.deps.mkdir(path.dirname(this.file), { recursive: true })
    await this.deps.writeFile(this.file, payload, 'utf8')
  }

  private async readRecord(): Promise<Record<string, unknown>> {
    let raw: string
    try {
      raw = await this.deps.readFile(this.file, 'utf8')
    } catch (error) {
      // A missing file on first run is expected and silent; anything else is a
      // real read failure worth a diagnostic, otherwise a permanently
      // unreadable file would reset preferences every launch with no trace.
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        console.warn('[preferences] could not read preferences.json; using defaults', error)
      }
      return {}
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      console.warn('[preferences] preferences.json is not an object; using defaults')
      return {}
    } catch (error) {
      console.warn('[preferences] preferences.json is not valid JSON; using defaults', error)
      return {}
    }
  }
}
