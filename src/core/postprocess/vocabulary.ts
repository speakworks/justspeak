import {
  POSTPROCESS_RULES,
  type PostprocessOptions,
  type PostprocessRule,
  type RuleSwitches,
  type Vocabulary,
  type VocabularyReplacement
} from './types'

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

/**
 * Validate a `vocabulary.json` payload into options. Unknown keys, wrong
 * types, and out-of-range thresholds are dropped rather than thrown, because a
 * hand-edited preferences file must never stop dictation.
 */
export function parseVocabularyConfig(raw: unknown): PostprocessOptions {
  if (!isRecord(raw)) return {}

  const options: PostprocessOptions = {}
  const replace = parseReplacements(raw.replace)
  const protect = parseProtect(raw.protect)
  if (replace.length > 0 || protect.length > 0) options.vocabulary = { replace, protect }

  const rules = parseRules(raw.rules)
  if (rules) options.rules = rules

  const threshold = raw.repetitionThreshold
  if (typeof threshold === 'number' && Number.isInteger(threshold) && threshold >= 2 && threshold <= 10) {
    options.repetitionThreshold = threshold
  }

  return options
}

export function serializeVocabularyConfig(options: PostprocessOptions): string {
  const vocabulary = options.vocabulary ?? {}
  const payload: Record<string, unknown> = {
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
