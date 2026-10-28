import {
  applySelfCorrections,
  collapseRepetitions,
  findCodeSpans,
  maskSpans,
  normalizeText,
  removeFillers,
  restoreSentenceCase
} from './rules'
import { applyVocabulary, findProtectSpans, ruleEnabled } from './vocabulary'
import type {
  PostprocessOptions,
  PostprocessResult,
  PostprocessRule,
  Vocabulary
} from './types'

export { POSTPROCESS_RULES } from './types'
export {
  parseVocabularyConfig,
  serializeVocabularyConfig,
  findLiteralSpans,
  applyVocabulary
} from './vocabulary'
export { normalizeText } from './rules'
export type {
  PostprocessOptions,
  PostprocessResult,
  PostprocessRule,
  RuleSwitches,
  Vocabulary,
  VocabularyReplacement
} from './types'

export const DEFAULT_REPETITION_THRESHOLD = 2

function record(
  applied: PostprocessRule[],
  rule: PostprocessRule,
  before: string,
  after: string
): void {
  if (before !== after) applied.push(rule)
}

/**
 * The deterministic text-cleaning stage. It is pure: text in, text plus the
 * list of rules that changed it out. No Electron, DOM, filesystem, network, or
 * clock is involved, so it runs identically for the fake and local providers.
 *
 * Order matters. Protected and code-like spans are masked first so nothing can
 * edit them. Vocabulary replacement runs before normalisation, as a user
 * spelling is the authority. Corrections resolve before fillers, so a filler
 * inside an abandoned fragment disappears with it.
 */
export function postprocess(text: string, options: PostprocessOptions = {}): PostprocessResult {
  if (text.length === 0) return { text, applied: [] }

  const vocabulary: Vocabulary = {
    replace: options.vocabulary?.replace ?? [],
    protect: options.vocabulary?.protect ?? []
  }
  const applied: PostprocessRule[] = []
  const threshold = Math.max(
    DEFAULT_REPETITION_THRESHOLD,
    Math.min(10, Math.floor(options.repetitionThreshold ?? DEFAULT_REPETITION_THRESHOLD))
  )

  // Protect entries survive NFKC too, so their mask is installed first.
  const protectMask = maskSpans(text, findProtectSpans(text, vocabulary.protect))
  let working = protectMask.masked

  if (ruleEnabled(options, 'vocabulary') && vocabulary.replace.length > 0) {
    const next = applyVocabulary(working, vocabulary)
    record(applied, 'vocabulary', working, next)
    working = next
  }

  const codeMask = maskSpans(working, findCodeSpans(working))
  working = codeMask.masked

  if (ruleEnabled(options, 'normalize')) {
    const next = normalizeText(working)
    record(applied, 'normalize', working, next)
    working = next
  }

  if (ruleEnabled(options, 'self-correction')) {
    const next = applySelfCorrections(working)
    record(applied, 'self-correction', working, next)
    working = next
  }

  if (ruleEnabled(options, 'filler')) {
    const next = removeFillers(working)
    record(applied, 'filler', working, next)
    working = next
  }

  if (ruleEnabled(options, 'repetition')) {
    const next = collapseRepetitions(working, threshold)
    record(applied, 'repetition', working, next)
    working = next
  }

  // Last, because fillers and corrections are what remove the sentence's
  // original first word. The function only touches the first Latin letter and
  // skips a protected/code-like mask, so it cannot lower or rewrite inner text.
  if (ruleEnabled(options, 'casing')) {
    const next = restoreSentenceCase(working)
    record(applied, 'casing', working, next)
    working = next
  }

  const output = protectMask.restore(codeMask.restore(working))

  // The safety contract: a non-empty input never becomes empty. If every rule
  // would delete it (a filler-only utterance, for example), inject the
  // original rather than sending nothing to the focused app.
  if (text.length > 0 && output.length === 0) return { text, applied: [] }

  return { text: output, applied }
}
