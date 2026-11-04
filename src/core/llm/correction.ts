import type { CorrectionAction } from './decision'

/**
 * Rule-gated application of an LLM correction decision.
 *
 * The model never sees an open-ended rewrite task: rules find a single
 * correction-marker candidate, the model picks one closed action, and this
 * module applies it while keeping the protected parts of the sentence intact.
 * A failed guard returns the original text.
 */

const MARKER = /(不对|我是说|改成|no\s+wait|i\s+mean)/giu
const SEPARATORS = new Set([
  ',', '，', ';', '；', ':', '：', '.', '．', '。', '!', '！', '?', '？', '、',
  '…', '‥', '︙', '︰'
])

export interface CorrectionCandidate {
  /** Start of the clause that would be abandoned. */
  clauseStart: number
  markerStart: number
  markerEnd: number
  /** First character after the marker's separator run. */
  afterStart: number
  /** The separator run before the marker contains an ellipsis form. */
  ellipsisBoundary: boolean
}

function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char)
}

function previousNonSpace(text: string, index: number): number {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!isSpace(text[i])) return i
  }
  return -1
}

function separatorRunStart(text: string, end: number): number {
  let start = end
  while (start > 0 && SEPARATORS.has(text[start - 1] ?? '')) start -= 1
  return start
}

function previousSeparator(text: string, index: number): number {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (SEPARATORS.has(text[i] ?? '')) return i
  }
  return -1
}

function isEllipsisRun(text: string, start: number, end: number): boolean {
  const run = text.slice(start, end)
  if (/[…‥︙︰]/.test(run)) return true
  return /\.{2,}|．{2,}/.test(run)
}

/**
 * Find exactly one marker set off by punctuation and followed by content.
 * Multiple markers are left to a future candidate-window design; returning
 * null here makes the stage conservative rather than guessing.
 */
export function findCorrectionCandidate(text: string): CorrectionCandidate | null {
  const matches = [...text.matchAll(MARKER)]
  if (matches.length !== 1) return null
  const match = matches[0] as RegExpMatchArray
  const markerStart = match.index
  if (markerStart === undefined) return null
  const markerEnd = markerStart + match[0].length

  const left = previousNonSpace(text, markerStart)
  if (left < 0 || !SEPARATORS.has(text[left] ?? '')) return null
  if (markerEnd < text.length && !isSpace(text[markerEnd]) && !SEPARATORS.has(text[markerEnd] ?? '')) {
    return null
  }

  let afterStart = markerEnd
  while (
    afterStart < text.length &&
    (isSpace(text[afterStart]) || SEPARATORS.has(text[afterStart] ?? ''))
  ) {
    afterStart += 1
  }
  if (afterStart >= text.length) return null

  const boundaryStart = separatorRunStart(text, left + 1)
  const previous = previousSeparator(text, boundaryStart)
  const clauseStart = previous + 1
  return {
    clauseStart,
    markerStart,
    markerEnd,
    afterStart,
    ellipsisBoundary: isEllipsisRun(text, boundaryStart, left + 1)
  }
}

export interface GuardResult {
  ok: boolean
  reason?: string
}

/**
 * Reject corrections that delete most of the sentence or rewrite numbers.
 * `\p{Nd}` covers full-width and other decimal digits; Chinese numerals
 * (一二三…) are not treated as numbers here, because they are ordinary words
 * in dictation and the length guard already bounds deletions.
 */
export function guardCorrection(original: string, corrected: string): GuardResult {
  if (original.length === 0) return { ok: corrected.length === 0, reason: 'empty input' }
  if (corrected.length === 0) return { ok: false, reason: 'empty result' }
  const ratio = corrected.length / original.length
  if (ratio < 0.3 || ratio > 1.2) return { ok: false, reason: `length ratio ${ratio.toFixed(2)}` }

  const originalNumbers = original.match(/\p{Nd}+/gu) ?? []
  const correctedNumbers = corrected.match(/\p{Nd}+/gu) ?? []
  if (originalNumbers.join('|') !== correctedNumbers.join('|')) {
    return { ok: false, reason: 'numbers changed' }
  }
  return { ok: true }
}

/**
 * Apply one closed action to a candidate. Unknown actions and
 * `delete_after_keep_before` are treated conservatively as marker-only: the
 * model cannot be trusted to identify a "repeat after the marker" without a
 * candidate window that describes it.
 */
export function applyCorrectionAction(
  text: string,
  candidate: CorrectionCandidate,
  action: CorrectionAction
): string {
  const markerOnly = (): string =>
    text.slice(0, candidate.markerStart) + text.slice(candidate.afterStart)

  switch (action) {
    case 'keep_all':
    case 'defer_to_human':
      return text
    case 'delete_after_keep_before':
    case 'delete_marker_only':
    case 'merge_ellipsis_keep':
      return markerOnly()
    case 'delete_before_keep_after':
      // Rule prior: an ellipsis means the speaker trailed off; do not delete
      // the preceding clause even if the model chose delete_before.
      return candidate.ellipsisBoundary
        ? markerOnly()
        : text.slice(0, candidate.clauseStart) + text.slice(candidate.afterStart)
    default:
      // A cast or a future action must fail closed, not fall through to the
      // most destructive branch.
      return text
  }
}

/**
 * What actually happened to one utterance. The evaluation harness needs this
 * to separate "the model decided to keep everything" from "the model never
 * answered", which a boolean `corrected` conflates.
 */
export type LlmOutcome =
  | 'no_candidate'
  | 'applied'
  | 'keep_all'
  | 'deferred'
  | 'guard_rejected'
  | 'no_change'

export interface LlmCorrectionResult {
  text: string
  applied: string[]
  /** True when the model's action survived the guard. */
  corrected: boolean
  outcome: LlmOutcome
}

export function applyLlmDecision(
  text: string,
  action: CorrectionAction | null,
  candidate = findCorrectionCandidate(text)
): LlmCorrectionResult {
  if (!candidate) return { text, applied: [], corrected: false, outcome: 'no_candidate' }
  if (action === null || action === 'defer_to_human') {
    return { text, applied: [], corrected: false, outcome: 'deferred' }
  }
  if (action === 'keep_all') return { text, applied: [], corrected: false, outcome: 'keep_all' }
  const next = applyCorrectionAction(text, candidate, action)
  if (next === text) return { text, applied: [], corrected: false, outcome: 'no_change' }
  const guard = guardCorrection(text, next)
  if (!guard.ok) {
    console.warn(`[llm] guard rejected correction: ${guard.reason ?? 'unknown'}`)
    return { text, applied: [], corrected: false, outcome: 'guard_rejected' }
  }
  return { text: next, applied: ['llm'], corrected: true, outcome: 'applied' }
}

export type LlmDecision = (text: string) => Promise<CorrectionAction | null>

/**
 * Run the optional stage. A missing candidate or a failed/timed-out decision
 * returns the rule-cleaned text untouched; this stage never blocks delivery on
 * the model.
 */
export async function correctWithLlm(
  text: string,
  decide: LlmDecision
): Promise<LlmCorrectionResult> {
  const candidate = findCorrectionCandidate(text)
  if (!candidate) return { text, applied: [], corrected: false, outcome: 'no_candidate' }
  let action: CorrectionAction | null
  try {
    action = await decide(text)
  } catch (error) {
    console.warn('[llm] decision failed', error)
    action = null
  }
  return applyLlmDecision(text, action, candidate)
}
