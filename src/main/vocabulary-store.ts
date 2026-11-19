import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  parseVocabularyConfigDetailed,
  serializeVocabularyConfig,
  type PostprocessOptions,
  type TermListParse
} from '../core/postprocess'

export interface VocabularyStoreDeps {
  readFile: typeof readFile
  writeFile: typeof writeFile
  mkdir: typeof mkdir
}

const DEFAULT_DEPS: VocabularyStoreDeps = { readFile, writeFile, mkdir }

export const VOCABULARY_FILE = 'vocabulary.json'

export type VocabularyState = 'default' | 'loaded' | 'unreadable'

export interface VocabularyLoadResult {
  options: PostprocessOptions
  state: VocabularyState
  /** Accepted decode-time terms plus the parse-time discard counts. */
  termList: TermListParse
  /** Human-readable reason when `state` is `unreadable`. */
  message?: string
}

function emptyTermList(): TermListParse {
  return {
    terms: [],
    droppedByComma: 0,
    droppedByCap: 0,
    droppedByInvalid: 0,
    droppedTermCount: 0
  }
}

/**
 * The personal word list lives in its own `userData/vocabulary.json`, next to
 * (but separate from) `preferences.json`. A missing file resolves to the
 * default options — every rule on, no replacements — because dictation must
 * never be blocked by a hand-edited file. A file that exists but cannot be
 * parsed is reported as `unreadable` instead of being silently ignored, so the
 * settings panel can tell the user why their words are not applied.
 */
export class VocabularyStore {
  readonly file: string
  private readonly deps: VocabularyStoreDeps

  constructor(userDataDir: string, deps: VocabularyStoreDeps = DEFAULT_DEPS) {
    this.file = path.join(userDataDir, VOCABULARY_FILE)
    this.deps = deps
  }

  async load(): Promise<PostprocessOptions> {
    return (await this.loadDetailed()).options
  }

  async loadDetailed(): Promise<VocabularyLoadResult> {
    let raw: string
    try {
      raw = await this.deps.readFile(this.file, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return { options: {}, state: 'default', termList: emptyTermList() }
      }
      console.warn('[vocabulary] could not read vocabulary.json; using defaults', error)
      return {
        options: {},
        state: 'unreadable',
        termList: emptyTermList(),
        message: `无法读取词汇表文件：${error instanceof Error ? error.message : String(error)}`
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      console.warn('[vocabulary] vocabulary.json is not valid JSON; using defaults', error)
      return {
        options: {},
        state: 'unreadable',
        termList: emptyTermList(),
        message: `词汇表文件不是有效的 JSON：${error instanceof Error ? error.message : String(error)}`
      }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn('[vocabulary] vocabulary.json is not an object; using defaults')
      return {
        options: {},
        state: 'unreadable',
        termList: emptyTermList(),
        message: '词汇表文件必须是一个 JSON 对象。'
      }
    }

    const detail = parseVocabularyConfigDetailed(parsed)
    return { options: detail.options, state: 'loaded', termList: detail.termList }
  }

  async save(options: PostprocessOptions): Promise<void> {
    await this.deps.mkdir(path.dirname(this.file), { recursive: true })
    await this.deps.writeFile(this.file, serializeVocabularyConfig(options), 'utf8')
  }
}
