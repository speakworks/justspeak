import {
  POSTPROCESS_RULES,
  type PostprocessOptions,
  type PostprocessRule,
  type RuleSwitches,
  type TermListParse,
  type Vocabulary,
  type VocabularyReplacement
} from './types'

/** The runtime prompt budget is enforced upstream; this is the app's own cap. */
export const MAX_VOCABULARY_TERMS = 32

export interface Span {
  start: number
  end: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAsciiWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char)
}

/**
 * Find literal occurrences of a word-list entry. ASCII entries are matched
 * case-insensitively and must sit on word boundaries so a short entry cannot
 * rewrite the inside of a longer word. CJK entries have no word boundary to
 * test, so they match literally.
 */
export function findLiteralSpans(text: string, needle: string): Span[] {
  if (!needle) return []
  const ascii = /^[\x00-\x7F]/.test(needle)
  const haystack = ascii ? text.toLowerCase() : text
  const target = ascii ? needle.toLowerCase() : needle
  const startsWord = isAsciiWordChar(needle[0])
  const endsWord = isAsciiWordChar(needle[needle.length - 1])
  const spans: Span[] = []

  let cursor = 0
  for (;;) {
    const index = haystack.indexOf(target, cursor)
    if (index < 0) break
    const end = index + needle.length
    const leftOk = !startsWord || !isAsciiWordChar(text[index - 1])
    const rightOk = !endsWord || !isAsciiWordChar(text[end])
    if (leftOk && rightOk) spans.push({ start: index, end })
    cursor = index + needle.length
  }

  return spans
}

/** Collect every occurrence of every protect entry. */
export function findProtectSpans(text: string, protect: readonly string[]): Span[] {
  return protect.flatMap((entry) => findLiteralSpans(text, entry))
}

function sortByStart(spans: Span[]): Span[] {
  return [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
}

/** Merge overlapping or touching spans into a sorted, minimal set. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = sortByStart([...spans])
  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end)
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

/**
 * Longest-first, case-insensitive word-list replacement. Replacements run
 * sequentially, which is what longest-match-first needs for overlapping
 * entries: the specific entry edits the text before a shorter one can see it.
 */
export function applyVocabulary(text: string, vocabulary: Vocabulary): string {
  const replacements = [...vocabulary.replace].sort((a, b) => b.from.length - a.from.length)
  let output = text

  for (const replacement of replacements) {
    const spans = sortByStart(findLiteralSpans(output, replacement.from))
    if (spans.length === 0) continue
    let next = ''
    let cursor = 0
    for (const span of spans) {
      next += output.slice(cursor, span.start) + replacement.to
      cursor = span.end
    }
    output = next + output.slice(cursor)
  }

  return output
}

/**
 * Apply replacements only to the text between protected and code-like spans.
 * Vocabulary runs before masking, so excluding those spans is what keeps a
 * numeric replacement from rewriting a mask id and what makes the "masked
 * first" invariant true for user literals. A replacement can never match
 * across an excluded span.
 */
export function applyVocabularyOutside(
  text: string,
  vocabulary: Vocabulary,
  excluded: readonly Span[]
): string {
  const merged = mergeSpans(excluded)
  if (merged.length === 0) return applyVocabulary(text, vocabulary)

  let output = ''
  let cursor = 0
  for (const span of merged) {
    if (span.start > cursor) {
      output += applyVocabulary(text.slice(cursor, span.start), vocabulary)
    }
    output += text.slice(span.start, span.end)
    cursor = Math.max(cursor, span.end)
  }
  output += applyVocabulary(text.slice(cursor), vocabulary)
  return output
}

function parseReplacements(value: unknown): VocabularyReplacement[] {
  const entries: VocabularyReplacement[] = []

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isRecord(item)) continue
      const from = item.from
      const to = item.to
      if (typeof from !== 'string' || typeof to !== 'string') continue
      if (!from.trim() || !to) continue
      entries.push({ from, to })
    }
  } else if (isRecord(value)) {
    for (const [from, to] of Object.entries(value)) {
      if (typeof to !== 'string' || !from.trim() || !to) continue
      entries.push({ from, to })
    }
  }

  return entries
}

function parseProtect(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) continue
    seen.add(item)
  }
  return [...seen]
}

function parseRules(value: unknown): RuleSwitches | undefined {
  if (!isRecord(value)) return undefined
  const rules: RuleSwitches = {}
  for (const rule of POSTPROCESS_RULES) {
    const stored = value[rule]
    if (typeof stored === 'boolean') rules[rule] = stored
  }
  return Object.keys(rules).length > 0 ? rules : undefined
}

const EMPTY_TERM_LIST: TermListParse = {
  terms: [],
  droppedByComma: 0,
  droppedByCap: 0,
  droppedByInvalid: 0,
  droppedTermCount: 0
}

/** A term the runtime would reject: C0 controls (NUL breaks `spawn`) or `<|` / `|>`. */
const INVALID_TERM = /[\u0000-\u001f]|<\||\|>/

/**
 * Normalise the vocabulary file's top-level `terms` array. Entries are
 * trimmed, empty entries are ignored, exact duplicates keep their first
 * occurrence, and at most the first 32 accepted terms survive. A term
 * containing U+002C is dropped and counted because `transcribe-cli`
 * tokenises `--vocabulary` on that character. A term containing a C0 control
 * character or a control-token delimiter is dropped silently: forwarding it
 * would make every transcription fail, and a hand-edited preferences file
 * must never stop dictation.
 */
export function parseTermList(value: unknown): TermListParse {
  if (!Array.isArray(value)) return { ...EMPTY_TERM_LIST, terms: [] }

  const terms: string[] = []
  const seen = new Set<string>()
  let droppedByComma = 0
  let droppedByCap = 0
  let droppedByInvalid = 0

  for (const item of value) {
    if (typeof item !== 'string') continue
    const term = item.trim()
    if (!term) continue
    if (term.includes(',')) {
      droppedByComma += 1
      continue
    }
    if (INVALID_TERM.test(term)) {
      droppedByInvalid += 1
      continue
    }
    if (seen.has(term)) continue
    if (terms.length >= MAX_VOCABULARY_TERMS) {
      droppedByCap += 1
      continue
    }
    seen.add(term)
    terms.push(term)
  }

  return {
    terms,
    droppedByComma,
    droppedByCap,
    droppedByInvalid,
    droppedTermCount: droppedByComma
  }
}

/**
 * One pasted block imported into an editable vocabulary list. `duplicates`
 * counts lines that repeated an earlier entry; `invalidLines` counts lines that
 * could not be parsed at all. Neither is silently folded into `entries`.
 */
export interface VocabularyImport<T> {
  entries: T[]
  duplicates: number
  invalidLines: number
}

/**
 * Split pasted text into terms or protected words: one per line, trimmed,
 * blank lines skipped, exact duplicates keeping the first occurrence. The
 * 32-term cap and the comma/invalid-character rules are deliberately not
 * applied here; saving normalises through `parseTermList`, so the editor may
 * hold more drafts than the file will accept.
 */
export function importTermLines(text: string): VocabularyImport<string> {
  const entries: string[] = []
  const seen = new Set<string>()
  let duplicates = 0

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (seen.has(line)) {
      duplicates += 1
      continue
    }
    seen.add(line)
    entries.push(line)
  }

  return { entries, duplicates, invalidLines: 0 }
}

/**
 * Split pasted replacement lines as `from => to`. Both sides are trimmed; a
 * line without `=>`, or with either side empty, is counted as invalid instead
 * of being dropped silently. Duplicates are keyed by `from`, keeping the first
 * occurrence so a later line cannot silently win.
 */
export function importReplacementLines(text: string): VocabularyImport<VocabularyReplacement> {
  const entries: VocabularyReplacement[] = []
  const seen = new Set<string>()
  let duplicates = 0
  let invalidLines = 0

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const arrow = line.indexOf('=>')
    if (arrow < 0) {
      invalidLines += 1
      continue
    }
    const from = line.slice(0, arrow).trim()
    const to = line.slice(arrow + 2).trim()
    if (!from || !to) {
      invalidLines += 1
      continue
    }
    if (seen.has(from)) {
      duplicates += 1
      continue
    }
    seen.add(from)
    entries.push({ from, to })
  }

  return { entries, duplicates, invalidLines }
}

/**
 * Normalise an untrusted save payload with the same parser the file read path
 * uses, so an accepted save cannot apply rules the file would reject on the
 * next load. Only `terms`, `replace`, and `protect` are read; rule switches
 * and thresholds are not part of the editor's payload.
 */
export function normalizeVocabularySavePayload(raw: unknown): PostprocessOptions {
  if (!isRecord(raw)) return {}
  return parseVocabularyConfig({
    terms: raw.terms,
    replace: raw.replace,
    protect: raw.protect
  })
}

export interface StarterLoadPlan {
  /** Existing entries first, then missing starter entries in starter order. */
  terms: string[]
  /** How many starter entries the existing list did not already contain. */
  added: number
  /** True when every starter entry is already present, so no save is needed. */
  complete: boolean
}

/**
 * Plan an explicit starter-list load. Presence is exact after trimming, which
 * matches what a save will store; entries already in the editor are never
 * duplicated, and the starter order only applies to the missing tail.
 */
export function planStarterLoad(
  existing: readonly string[],
  starter: readonly string[]
): StarterLoadPlan {
  const merged: string[] = []
  const seen = new Set<string>()
  for (const candidate of existing) {
    const term = candidate.trim()
    if (!term || seen.has(term)) continue
    seen.add(term)
    merged.push(term)
  }
  let added = 0
  for (const candidate of starter) {
    const term = candidate.trim()
    if (!term || seen.has(term)) continue
    seen.add(term)
    merged.push(term)
    added += 1
  }
  return { terms: merged, added, complete: added === 0 }
}

export interface ParsedVocabularyConfig {
  options: PostprocessOptions
  /** The accepted terms and discard counts, kept beside the options shape. */
  termList: TermListParse
}

/**
 * Validate a `vocabulary.json` payload into options plus the term-list parse
 * result. Unknown keys, wrong types, and out-of-range thresholds are dropped
 * rather than thrown, because a hand-edited preferences file must never stop
 * dictation.
 */
export function parseVocabularyConfigDetailed(raw: unknown): ParsedVocabularyConfig {
  if (!isRecord(raw)) return { options: {}, termList: { ...EMPTY_TERM_LIST, terms: [] } }

  const options: PostprocessOptions = {}
  const termList = parseTermList(raw.terms)
  // Terms are a file-level setting beside the rule vocabulary, never part of
  // it, so they can never reach the rule pass.
  options.terms = termList.terms
  const replace = parseReplacements(raw.replace)
  const protect = parseProtect(raw.protect)
  if (replace.length > 0 || protect.length > 0) {
    options.vocabulary = { replace, protect }
  }

  const rules = parseRules(raw.rules)
  if (rules) options.rules = rules

  // The Han threshold has a floor of 3; a stored 2 is ignored and the default
  // applies. The keep list is retained for a future lower floor.
  const threshold = raw.repetitionThreshold
  if (typeof threshold === 'number' && Number.isInteger(threshold) && threshold >= 3 && threshold <= 10) {
    options.repetitionThreshold = threshold
  }

  return { options, termList }
}

export function parseVocabularyConfig(raw: unknown): PostprocessOptions {
  return parseVocabularyConfigDetailed(raw).options
}

export function serializeVocabularyConfig(options: PostprocessOptions): string {
  const vocabulary = options.vocabulary ?? {}
  const payload: Record<string, unknown> = {
    // An old file without terms serializes as an empty array, never a throw.
    terms: options.terms ?? [],
    replace: vocabulary.replace ?? [],
    protect: vocabulary.protect ?? []
  }
  if (options.rules) payload.rules = options.rules
  if (options.repetitionThreshold !== undefined) {
    payload.repetitionThreshold = options.repetitionThreshold
  }
  return JSON.stringify(payload, null, 2)
}

export function ruleEnabled(options: PostprocessOptions, rule: PostprocessRule): boolean {
  return options.rules?.[rule] !== false
}
