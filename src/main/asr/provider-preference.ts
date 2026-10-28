import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { SelectableAsrProviderId } from '../../shared/ipc'

export interface ProviderPreferenceStoreDeps {
  readFile: typeof readFile
  writeFile: typeof writeFile
  mkdir: typeof mkdir
}

const DEFAULT_DEPS: ProviderPreferenceStoreDeps = { readFile, writeFile, mkdir }

/**
 * Persists the selected ASR provider next to the theme preference but in its
 * own file, so a theme write cannot drop the provider (and vice versa).
 *
 * `load` returns the stored string unvalidated on purpose: unknown ids must
 * reach `resolveAsrMode` and fail visibly instead of silently becoming qwen3.
 * A missing or corrupt file is not a provider value and resolves to undefined,
 * which means "use the default".
 */
export class ProviderPreferenceStore {
  private readonly file: string
  private readonly deps: ProviderPreferenceStoreDeps

  constructor(userDataDir: string, deps: ProviderPreferenceStoreDeps = DEFAULT_DEPS) {
    this.file = path.join(userDataDir, 'asr-preference.json')
    this.deps = deps
  }

  async load(): Promise<string | undefined> {
    try {
      const raw = await this.deps.readFile(this.file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) {
        console.warn('[asr] asr-preference.json is not an object; using the default provider')
        return undefined
      }
      const provider = (parsed as Record<string, unknown>).provider
      if (typeof provider !== 'string' || provider.length === 0) return undefined
      return provider
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        console.warn('[asr] could not read asr-preference.json; using the default provider', error)
      }
      return undefined
    }
  }

  async save(provider: SelectableAsrProviderId): Promise<void> {
    await this.deps.mkdir(path.dirname(this.file), { recursive: true })
    await this.deps.writeFile(this.file, JSON.stringify({ provider }, null, 2), 'utf8')
  }
}
