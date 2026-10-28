import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parseHotkeyPreference } from '../core/hotkey/accelerator'
import { parseThemePreference } from '../core/theme/theme'
import type { ThemePreference } from '../shared/ipc'

export interface ThemeStoreDeps {
  readFile: typeof readFile
  writeFile: typeof writeFile
  mkdir: typeof mkdir
}

/** Everything persisted in `userData/preferences.json`. */
export interface StoredPreferences {
  theme: ThemePreference
  hotkey: string
}

const DEFAULT_DEPS: ThemeStoreDeps = { readFile, writeFile, mkdir }

/**
 * Persists preferences as one small JSON file under userData.
 * A missing or corrupt file resolves to defaults; it never throws, because a
 * preference read must not block startup. Writes merge into the existing
 * object so saving a hotkey cannot drop the theme (or any future key).
 */
export class ThemeStore {
  private readonly file: string
  private readonly deps: ThemeStoreDeps
  /** Tail of the write chain; see `write` for why writes must not interleave. */
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
    await this.write({ theme })
  }

  async saveHotkey(hotkey: string): Promise<void> {
    await this.write({ hotkey: parseHotkeyPreference(hotkey) })
  }

  /**
   * Unknown keys survive a write: a corrupt or non-object file is treated as
   * empty, which is the same tolerance `load` already had.
   *
   * `theme:set` and `hotkey:set` are independent async handlers, so two saves
   * can otherwise both read the old object and then write only their own key,
   * dropping the other preference. Chaining every read-modify-write makes the
   * last writer observe the previous result.
   */
  private write(patch: Record<string, unknown>): Promise<void> {
    const next = this.writeQueue.then(() => this.writeNow(patch))
    // A failed save must reject its own caller without poisoning the chain.
    this.writeQueue = next.catch(() => {})
    return next
  }

  private async writeNow(patch: Record<string, unknown>): Promise<void> {
    const existing = await this.readRecord()
    const payload = JSON.stringify({ ...existing, ...patch }, null, 2)
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
