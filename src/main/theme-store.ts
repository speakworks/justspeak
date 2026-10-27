import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parseThemePreference } from '../core/theme/theme'
import type { ThemePreference } from '../shared/ipc'

export interface ThemeStoreDeps {
  readFile: typeof readFile
  writeFile: typeof writeFile
  mkdir: typeof mkdir
}

const DEFAULT_DEPS: ThemeStoreDeps = { readFile, writeFile, mkdir }

/**
 * Persists the theme preference as a small JSON file under userData.
 * A missing or corrupt file resolves to `system`; it never throws, because a
 * theme read must not block startup.
 */
export class ThemeStore {
  private readonly file: string
  private readonly deps: ThemeStoreDeps

  constructor(userDataDir: string, deps: ThemeStoreDeps = DEFAULT_DEPS) {
    this.file = path.join(userDataDir, 'preferences.json')
    this.deps = deps
  }

  async load(): Promise<ThemePreference> {
    try {
      const raw = await this.deps.readFile(this.file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        return parseThemePreference((parsed as Record<string, unknown>).theme)
      }
      return 'system'
    } catch {
      // No file yet (first run) or unreadable/corrupt: fall back to `system`.
      return 'system'
    }
  }

  async save(theme: ThemePreference): Promise<void> {
    const payload = JSON.stringify({ theme }, null, 2)
    await this.deps.mkdir(path.dirname(this.file), { recursive: true })
    await this.deps.writeFile(this.file, payload, 'utf8')
  }
}
