import {
  normalizeVocabularySavePayload,
  type PostprocessOptions
} from '../core/postprocess'
import type { VocabularyLoadResult, VocabularyStore } from './vocabulary-store'

/** The store surface the save path needs; tests may supply a fake. */
export type VocabularySaveStore = Pick<VocabularyStore, 'save' | 'loadDetailed'>

export type VocabularySaveOutcome =
  | { ok: true; options: PostprocessOptions; load: VocabularyLoadResult }
  | { ok: false; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A save payload must carry all three lists so a malformed call cannot be
 * coerced into an empty file by the tolerant parser. Contents are still
 * re-normalised afterwards; this only rejects a missing or wrong-shaped field.
 */
export function isVocabularySavePayload(
  raw: unknown
): raw is { terms: unknown[]; replace: unknown[]; protect: unknown[] } {
  return (
    isRecord(raw) &&
    Array.isArray(raw.terms) &&
    Array.isArray(raw.replace) &&
    Array.isArray(raw.protect)
  )
}

/**
 * A single-lane promise queue. Each task chains onto the previous one, so two
 * saves cannot interleave their write and read-back and report each other's
 * file. A failed task does not break the lane: the tail swallows the rejection
 * while the caller still receives it.
 */
export function createSaveQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }
}

/**
 * The single save-and-read-back step. Normalisation reuses the file parser, the
 * store writes atomically, and only a successful read-back yields the options
 * main may hand to the next dictation. Any failure returns a reason and no
 * options, so the caller cannot accidentally apply a half-saved state.
 *
 * The editor owns only the three lists, so the current file's rule switches and
 * repetition threshold are read first and carried into the write; otherwise a
 * hand-edited `rules` / `repetitionThreshold` would be erased by the next
 * interface save. An unreadable file has nothing to preserve, which matches the
 * existing repair behaviour.
 */
export async function saveVocabularyPayload(
  store: VocabularySaveStore,
  raw: unknown
): Promise<VocabularySaveOutcome> {
  if (!isVocabularySavePayload(raw)) {
    return { ok: false, message: '词汇表数据无效。' }
  }

  const options = normalizeVocabularySavePayload(raw)
  const current = await store.loadDetailed()
  if (current.options.rules !== undefined) options.rules = current.options.rules
  if (current.options.repetitionThreshold !== undefined) {
    options.repetitionThreshold = current.options.repetitionThreshold
  }

  try {
    await store.save(options)
  } catch (error) {
    return {
      ok: false,
      message: `保存词汇表失败：${error instanceof Error ? error.message : String(error)}`
    }
  }

  const load = await store.loadDetailed()
  if (load.state === 'unreadable') {
    return { ok: false, message: load.message ?? '词汇表已写入但无法读回。' }
  }
  return { ok: true, options: load.options, load }
}
