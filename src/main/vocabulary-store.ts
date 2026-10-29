import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  parseVocabularyConfig,
  serializeVocabularyConfig,
  type PostprocessOptions
} from '../core/postprocess'

export interface VocabularyStoreDeps {
  readFile: typeof readFile
  writeFile: typeof writeFile
  mkdir: typeof mkdir
}

const DEFAULT_DEPS: VocabularyStoreDeps = { readFile, writeFile, mkdir }

export const VOCABULARY_FILE = 'vocabulary.json'

/**
 * The personal word list lives in its own `userData/vocabulary.json`, next to
 * (but separate from) `preferences.json`. A missing or corrupt file resolves
 * to the default options — every rule on, no replacements — because dictation
 * must never be blocked by a hand-edited file.
 */
export class VocabularyStore {
  private readonly file: string
  private readonly deps: VocabularyStoreDeps

  constructor(userDataDir: string, deps: VocabularyStoreDeps = DEFAULT_DEPS) {
    this.file = path.join(userDataDir, VOCABULARY_FILE)
    this.deps = deps
  }

  async load(): Promise<PostprocessOptions> {
    try {
      const raw = await this.deps.readFile(this.file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) {
        console.warn('[vocabulary] vocabulary.json is not an object; using defaults')
        return {}
      }
      return parseVocabularyConfig(parsed)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        console.warn('[vocabulary] could not read vocabulary.json; using defaults', error)
      }
      return {}
    }
  }

  async save(options: PostprocessOptions): Promise<void> {
    await this.deps.mkdir(path.dirname(this.file), { recursive: true })
    await this.deps.writeFile(this.file, serializeVocabularyConfig(options), 'utf8')
  }
}
