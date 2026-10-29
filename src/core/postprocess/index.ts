import {
  applySelfCorrections,
  collapseRepetitions,
  containsSentinel,
  findCodeSpans,
  findPunctuationRunSpans,
  maskSpans,
  normalizeText,
  removeFillers,
  removeSpacesBeforePunctuation,
  restoreSentenceCase,
  type MaskedText
} from './rules'
import {
  applyVocabulary,
  applyVocabularyOutside,
  findProtectSpans,
  ruleEnabled
} from './vocabulary'
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

// Shortest Han-character run that collapse removes. Three is deliberate: a
// two-character Han reduplication is a productive, legitimate pattern
// (默默, 冉冉, 匆匆, 津津), while `我我我` is a stutter. Latin word repeats
// collapse at two independently.
export const DEFAULT_REPETITION_THRESHOLD = 3

function record(
  applied: PostprocessRule[],
  rule: PostprocessRule,
  before: string,
  after: string
): void {
  if (before !== after) applied.push(rule)
}

/** First visible character, resolving nested protect/code placeholders. */
function firstVisibleCharacter(
  value: string,
  masks: readonly MaskedText[]
): string | undefined {
  let current = value
  for (let depth = 0; depth < 8; depth += 1) {
    let resolved: string | undefined
    for (const mask of masks) {
      resolved = mask.resolveLeading(current)
      if (resolved !== undefined) break
    }
    if (resolved === undefined) return current[0]
    current = resolved
  }
  return current[0]
}

/**
 * The deterministic text-cleaning stage. It is pure: text in, text plus the
 * list of rules that changed it out. No Electron, DOM, filesystem, network, or
 * clock is involved, so it runs identically for the fake and local providers.
 *
 * Order matters. Vocabulary edits only the text between protected and
 * code-like spans, so it cannot rewrite a user literal or a mask id; then the
 * two disjoint mask layers hide those spans from normalisation and the rule
 * pass. Vocabulary still runs before normalisation, as a user spelling is the
 * authority. Corrections resolve before fillers, so a filler inside an
 * abandoned fragment disappears with it.
 */
export function postprocess(text: string, options: PostprocessOptions = {}): PostprocessResult {
  if (text.length === 0) return { text, applied: [] }

  const vocabulary: Vocabulary = {
    replace: options.vocabulary?.replace ?? [],
    protect: options.vocabulary?.protect ?? []
  }
  const applied: PostprocessRule[] = []
  const requestedThreshold = options.repetitionThreshold
  // A non-finite value would poison Math.min/Math.max into NaN and silently
  // disable collapse; fall back to the documented floor instead.
  const threshold =
    typeof requestedThreshold === 'number' && Number.isFinite(requestedThreshold)
      ? Math.max(DEFAULT_REPETITION_THRESHOLD, Math.min(10, Math.floor(requestedThreshold)))
      : DEFAULT_REPETITION_THRESHOLD

  let working = text
  if (ruleEnabled(options, 'vocabulary') && vocabulary.replace.length > 0) {
    // Code-like spans are part of the exclusion, so "masked first" is true for
    // literals as well as for protect entries even though vocabulary runs
    // before the masks are installed.
    const excluded = [...findProtectSpans(text, vocabulary.protect), ...findCodeSpans(text)]
    const next = applyVocabularyOutside(text, vocabulary, excluded)
    record(applied, 'vocabulary', working, next)
    working = next
  }

  // Re-detect on the vocabulary output: a replacement can move spans or
  // introduce a new protected or code-like token.
  const protectMask = maskSpans(
    working,
    findProtectSpans(working, vocabulary.protect),
    'protect'
  )
  const codeMask = maskSpans(
    protectMask.masked,
    findCodeSpans(protectMask.masked, protectMask.placeholderSpans),
    'code',
    protectMask.placeholderSpans
  )

  // Punctuation runs are masked before NFKC so `……` is not expanded and the
  // first dot of `...` cannot become `。`. Code and protect placeholders are
  // opaque to the detector and carried through the mask.
  const punctuationMask = maskSpans(
    codeMask.masked,
    findPunctuationRunSpans(codeMask.masked, codeMask.placeholderSpans),
    'punctuation',
    codeMask.placeholderSpans
  )
  working = punctuationMask.masked

  let removedLeading = false
  let normalizeChanged = false

  if (ruleEnabled(options, 'normalize')) {
    const next = normalizeText(working)
    normalizeChanged = next !== working
    working = next
  }

  working = punctuationMask.restore(working)

  // The runs are visible again. Remove stray spacing before their first mark
  // now, so masking never has to shift placeholder positions.
  if (ruleEnabled(options, 'normalize')) {
    const next = removeSpacesBeforePunctuation(working)
    normalizeChanged ||= next !== working
    working = next
  }
  if (normalizeChanged) applied.push('normalize')

  const firstVisible = (value: string): string | undefined =>
    firstVisibleCharacter(value, [codeMask, protectMask])

  if (ruleEnabled(options, 'self-correction')) {
    const result = applySelfCorrections(working)
    record(applied, 'self-correction', working, result.text)
    removedLeading ||= result.removedLeading
    working = result.text
  }

  if (ruleEnabled(options, 'filler')) {
    const result = removeFillers(working, firstVisible)
    record(applied, 'filler', working, result.text)
    removedLeading ||= result.removedLeading
    working = result.text
  }

  if (ruleEnabled(options, 'repetition')) {
    const next = collapseRepetitions(working, threshold)
    record(applied, 'repetition', working, next)
    working = next
  }

  // Only after a rule actually removed the sentence's original first word.
  // The function touches only the first Latin letter and skips a
  // protected/code-like mask, so it cannot lower or rewrite inner text.
  if (ruleEnabled(options, 'casing') && removedLeading) {
    const next = restoreSentenceCase(working)
    record(applied, 'casing', working, next)
    working = next
  }

  const output = protectMask.restore(codeMask.restore(working))

  // Fail closed on a sentinel leak: never emit invisible control characters.
  if (containsSentinel(output)) return { text, applied: [] }

  // The safety contract: a non-empty input never becomes empty. If every rule
  // would delete it (a filler-only utterance, for example), inject the
  // original rather than sending nothing to the focused app.
  if (text.length > 0 && output.length === 0) return { text, applied: [] }

  return { text: output, applied }
}
