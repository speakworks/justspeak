import { findLiteralSpans, mergeSpans, type Span } from './vocabulary'

/* ------------------------------------------------------------------ */
/* Masking                                                             */
/* ------------------------------------------------------------------ */

export type MaskLayer = 'protect' | 'code' | 'punctuation'

interface MaskMarkers {
  start: string
  end: string
}

/**
 * Two provably disjoint sentinel namespaces. A restore only matches its own
 * start/end pair, so restoring the code layer can never rewrite a protect
 * placeholder (the previous shared `<id>` scheme did exactly that).
 */
const MASK_MARKERS: Readonly<Record<MaskLayer, MaskMarkers>> = {
  protect: { start: '\uE000', end: '\uE001' },
  code: { start: '\uE002', end: '\uE003' },
  punctuation: { start: '\uE004', end: '\uE005' }
}

export const MASK_SENTINELS: readonly string[] = Object.values(MASK_MARKERS).flatMap(
  ({ start, end }) => [start, end]
)

export function containsSentinel(text: string): boolean {
  return MASK_SENTINELS.some((sentinel) => text.includes(sentinel))
}

function isMaskStart(char: string | undefined): boolean {
  return (
    char !== undefined &&
    (char === MASK_MARKERS.protect.start || char === MASK_MARKERS.code.start)
  )
}

export interface MaskedText {
  masked: string
  restore: (value: string) => string
}

/**
 * A deterministic per-call namespace derived from the text and its spans. The
 * extra salt keeps the prefix out of the input, so restore can only rewrite
 * placeholders this masker emitted and never sentinel-shaped user text.
 */
function maskNonce(text: string, markers: MaskMarkers, originals: readonly string[]): string {
  let hash = 0x811c9dc5
  const payload = `${markers.start}\u0000${text}\u0000${originals.join('\u0000')}`
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  const base = (hash >>> 0).toString(36)
  let nonce = base
  let salt = 0
  while (text.includes(`${markers.start}${nonce}.`)) {
    salt += 1
    nonce = `${base}x${salt}`
  }
  return nonce
}

/**
 * Replace spans with private-use placeholders so no rule can edit them, then
 * put the original text back. Placeholder ids stay stable while rules delete
 * or reorder the text around them. The layer chooses the namespace, and each
 * restore matches only that namespace and that call's nonce.
 */
export function maskSpans(text: string, spans: readonly Span[], layer: MaskLayer): MaskedText {
  const merged = mergeSpans(spans)
  if (merged.length === 0) return { masked: text, restore: (value) => value }

  const markers = MASK_MARKERS[layer]
  const originals = merged.map((span) => text.slice(span.start, span.end))
  const nonce = maskNonce(text, markers, originals)

  let masked = ''
  let cursor = 0
  for (let index = 0; index < merged.length; index += 1) {
    const span = merged[index] as Span
    masked += text.slice(cursor, span.start)
    masked += `${markers.start}${nonce}.${index}${markers.end}`
    cursor = span.end
  }
  masked += text.slice(cursor)

  const pattern = new RegExp(`${markers.start}${nonce}\\.(\\d+)${markers.end}`, 'g')
  return {
    masked,
    restore: (value) =>
      value.replace(pattern, (placeholder, index: string) => originals[Number(index)] ?? placeholder)
  }
}

/* ------------------------------------------------------------------ */
/* Code-like tokens                                                    */
/* ------------------------------------------------------------------ */

// Anything that looks like a literal rather than prose: a normalisation or
// punctuation rule must not edit it. Over-matching is safe because masking
// only prevents edits; it never removes text.
const CODE_PATTERNS: readonly RegExp[] = [
  /`[^`\n]+`/g,
  /\b(?:https?|ftp):\/\/[^\s<>"'`]+/gi,
  /\bwww\.[^\s<>"'`]+/gi,
  // The lookbehind prevents a restart inside a local part, and the bounds cap
  // backtracking: a bare greedy local part was quadratic on long tokens.
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}\b/g,
  /(?<=^|[\s(（"'\[])(?:\/[\w.@%+-]+){2,}/g,
  /\b[A-Za-z]:\\[^\s<>"'`]+/g,
  /\b[A-Za-z_$][\w$]*\([^()\n]*\)/g,
  /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g,
  /\b\d+(?:\.\d+){1,}\b/g,
  /\b\d+(?:\.\d+)?\s?(?:ms|s|hz|khz|mhz|ghz|mb|gb|kb|tb|px|dpi|fps|kg|km|cm|mm|°c|%)/gi,
  /\b[A-Za-z_$][A-Za-z0-9_$]*(?:[._-][A-Za-z0-9_$]+)+\b/g,
  /\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g,
  /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g,
  /(?<=\s|^)--?[A-Za-z][\w-]*/g,
  /\$[A-Za-z_][A-Za-z0-9_]*|\$\{[^}]+\}/g,
  // Bare multi-word commands are literals too: `pnpm test` must not become
  // `Pnpm test` just because it starts a sentence.
  /\b(?:pnpm|npm|yarn|npx|bun|deno)\s+[\w@./:=+-]+(?:\s+[\w@./:=+-]+)*/gi,
  /\bgit\s+(?:commit|push|pull|merge|rebase|checkout|switch|status|diff|log|branch|tag|stash|add|reset|clone|fetch|cherry-pick|revert|worktree)(?:\s+[\w@./:=+-]+)*/g,
  /\b(?:cargo|docker|kubectl|brew)\s+[\w@./:=+-]+(?:\s+[\w@./:=+-]+)*/g,
  /\bgo\s+(?:build|test|run|mod|get|install)(?:\s+[\w@./:=+-]+)*/g,
  /\b(?:python3?|node)\s+[\w./-]+(?:\s+[\w@./:=+-]+)*/g,
  /\b[0-9a-f]{7,40}\b/gi
]

export function findCodeSpans(text: string): Span[] {
  const spans: Span[] = []
  for (const pattern of CODE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue
      spans.push({ start: match.index, end: match.index + match[0].length })
    }
  }
  return spans
}

// Punctuation runs are atomic: a width conversion or a per-character collapse
// must not split `...` into `。.`. A lone `…` is included because NFKC would
// otherwise turn it into three dots and lose the original character.
const PUNCTUATION_RUN_CHARS = new Set([
  '.', '…', '!', '?', ',', ';', ':', '。', '，', '！', '？', '；', '：', '、'
])

export function findPunctuationRunSpans(text: string): Span[] {
  const spans: Span[] = []
  let index = 0
  while (index < text.length) {
    if (!PUNCTUATION_RUN_CHARS.has(text[index] ?? '')) {
      index += 1
      continue
    }
    const start = index
    while (index < text.length && PUNCTUATION_RUN_CHARS.has(text[index] ?? '')) index += 1
    const run = text.slice(start, index)
    if (run.includes('…') || run.length >= 2) spans.push({ start, end: index })
  }
  return spans
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

const HAN = /\p{Script=Han}/u
const LATIN = /\p{Script=Latin}/u

export function dominantScript(text: string): 'zh' | 'en' {
  let han = 0
  let latinWords = 0
  let inLatin = false
  for (const char of text) {
    if (HAN.test(char)) {
      han += 1
      inLatin = false
    } else if (LATIN.test(char)) {
      // One long identifier must not outvote a Chinese sentence, so Latin is
      // counted in runs rather than characters.
      if (!inLatin) latinWords += 1
      inLatin = true
    } else {
      inLatin = false
    }
  }
  return han > 0 && han >= latinWords ? 'zh' : 'en'
}

const ASCII_TO_CJK: Readonly<Record<string, string>> = {
  ',': '，',
  '.': '。',
  '!': '！',
  '?': '？',
  ':': '：',
  ';': '；'
}

const CJK_TO_ASCII: Readonly<Record<string, string>> = {
  '，': ',',
  '。': '.',
  '！': '!',
  '？': '?',
  '：': ':',
  '；': ';',
  '、': ','
}

function neighbourIsHan(text: string, index: number, direction: -1 | 1): boolean {
  for (let i = index + direction; i >= 0 && i < text.length; i += direction) {
    const char = text[i] ?? ''
    if (/\s/.test(char)) continue
    return HAN.test(char)
  }
  return false
}

/**
 * ASCII punctuation only becomes full-width when it actually touches a Han
 * character, so an abbreviation such as `e.g.` inside Chinese prose is not
 * turned into `e。g。`. CJK punctuation in a Latin-dominant text always
 * becomes ASCII, because it cannot be anything else.
 */
export function normalizePunctuation(text: string): string {
  if (dominantScript(text) === 'en') {
    return [...text].map((char) => CJK_TO_ASCII[char] ?? char).join('')
  }

  let output = ''
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? ''
    const cjk = ASCII_TO_CJK[char]
    // A full stop needs Han on its left: otherwise the `.` in an abbreviation
    // followed by Chinese (e.g. "e.g. 这样") would become a Chinese full stop.
    const convert =
      cjk !== undefined &&
      (char === '.'
        ? neighbourIsHan(text, i, -1)
        : neighbourIsHan(text, i, -1) || neighbourIsHan(text, i, 1))
    output += convert ? cjk : char
  }
  return output
}

export function normalizeSpacing(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?，。；：！？、])/g, '$1')
    .replace(/([，。；：！？、])\s+/g, '$1')
    .trim()
}

export function normalizeText(text: string): string {
  // Node ships NFKC; no dependency is needed for Unicode normalisation.
  return normalizeSpacing(normalizePunctuation(text.normalize('NFKC')))
}

/* ------------------------------------------------------------------ */
/* Self-corrections                                                    */
/* ------------------------------------------------------------------ */

const SEPARATORS = new Set([
  ',', '，', ';', '；', ':', '：', '.', '。', '!', '！', '?', '？', '、', '…'
])

const COMMA_SEPARATORS = new Set([',', '，', ';', '；', ':', '：'])

const CJK_SEPARATORS = new Set(['，', '。', '；', '：', '！', '？', '、'])

const SENTENCE_SEPARATORS = new Set(['.', '。', '!', '！', '?', '？', '…'])

// Characters that can precede the first word without starting it. Quotes and
// brackets are transparent for casing and for "leading removal" detection; a
// mask placeholder is not, because its case belongs to the user.
const LEADING_TRANSPARENT = new Set([
  '"', "'", '“', '”', '‘', '’', '(', ')', '[', ']', '{', '}',
  '（', '）', '【', '】', '「', '」', '『', '』', '《', '》', '〈', '〉'
])

/** True when only whitespace and opening quotes precede `index`. */
function isLeadingPosition(text: string, index: number): boolean {
  for (let i = 0; i < index; i += 1) {
    const char = text[i] ?? ''
    if (/\s/.test(char) || LEADING_TRANSPARENT.has(char)) continue
    return false
  }
  return true
}

/** End of the whole separator run starting at `index` (not including spaces). */
function separatorRunEnd(text: string, index: number): number {
  let end = index
  while (end < text.length && SEPARATORS.has(text[end] ?? '')) end += 1
  return end
}

export interface RuleResult {
  text: string
  /** A deletion started at the beginning of the text. */
  removedLeading: boolean
}

const MARKER_PATTERN = /no\s+wait|i\s+mean|不对|我是说/giu

function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char)
}

function previousNonSpace(text: string, index: number): number {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!isSpace(text[i])) return i
  }
  return -1
}

function nextNonSpace(text: string, index: number): number {
  for (let i = index; i < text.length; i += 1) {
    if (!isSpace(text[i])) return i
  }
  return -1
}

function previousSeparator(text: string, index: number): number {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (SEPARATORS.has(text[i] ?? '')) return i
  }
  return -1
}

interface Deletion {
  start: number
  end: number
}

const MARKER_AT_START = /^(?:no\s+wait|i\s+mean|不对|我是说)/i

function matchMarkerAt(text: string, index: number): number | null {
  if (index >= text.length) return null
  const match = MARKER_AT_START.exec(text.slice(index))
  return match ? index + match[0].length : null
}

/**
 * A marker counts only when punctuation (or the start of the text) sets it
 * off and replacement content follows it. A run of markers ("不对，我是说C")
 * is one correction: the abandoned fragment starts after the separator before
 * the first marker and the deletion runs through the last marker.
 *
 * The fragment is the clause immediately before the marker; earlier clauses
 * survive. Words before the first separator in the same clause are part of
 * the fragment, so "send it Monday, no wait, Tuesday" yields "Tuesday" — a
 * parser would be needed to know that only "Monday" is abandoned.
 */
function findCorrectionDeletion(text: string): Deletion | null {
  for (const match of text.matchAll(MARKER_PATTERN)) {
    const start = match.index
    if (start === undefined) continue
    const end = start + match[0].length

    const left = previousNonSpace(text, start)
    if (left >= 0 && !SEPARATORS.has(text[left] ?? '')) continue
    if (end < text.length && !isSpace(text[end]) && !SEPARATORS.has(text[end] ?? '')) continue

    let content = end
    while (content < text.length && (isSpace(text[content]) || SEPARATORS.has(text[content] ?? ''))) {
      content += 1
    }
    if (content >= text.length) continue

    // The clause ending at the separator directly before the marker is the
    // abandoned fragment; anything before the preceding separator survives.
    const previous = left >= 0 ? previousSeparator(text, left) : -1
    const fragmentStart = previous + 1

    let deleteEnd = end
    for (;;) {
      let cursor = deleteEnd
      while (
        cursor < text.length &&
        (isSpace(text[cursor]) || SEPARATORS.has(text[cursor] ?? ''))
      ) {
        cursor += 1
      }
      const nextMarkerEnd = matchMarkerAt(text, cursor)
      if (nextMarkerEnd === null) break
      deleteEnd = nextMarkerEnd
    }

    // Consume the entire separator run after the marker, not one character:
    // `No wait... Tuesday.` must not become `. Tuesday.`.
    while (
      deleteEnd < text.length &&
      (isSpace(text[deleteEnd]) || SEPARATORS.has(text[deleteEnd] ?? ''))
    ) {
      deleteEnd += 1
    }

    return { start: fragmentStart, end: deleteEnd }
  }

  return null
}

export function applySelfCorrections(text: string): RuleResult {
  let output = text
  let removedLeading = false
  // A handful of markers can chain ("A, no wait, B, no wait, C"); the bound
  // makes the rule total even on adversarial input.
  for (let pass = 0; pass < 8; pass += 1) {
    const deletion = findCorrectionDeletion(output)
    if (!deletion) break
    if (isLeadingPosition(output, deletion.start)) removedLeading = true
    const before = output.slice(0, deletion.start)
    const after = output.slice(deletion.end)
    // Deleting a clause can butt a Latin sentence stop against the next word;
    // Chinese punctuation already separates without a space.
    const left = before[before.length - 1]
    const right = after[0]
    const joiner =
      left !== undefined &&
      right !== undefined &&
      !isSpace(left) &&
      !isSpace(right) &&
      !SEPARATORS.has(right) &&
      !CJK_SEPARATORS.has(left)
        ? ' '
        : ''
    output = before + joiner + after
  }
  return { text: normalizeSpacing(output), removedLeading }
}

/* ------------------------------------------------------------------ */
/* Filler removal                                                      */
/* ------------------------------------------------------------------ */

const CHINESE_FILLERS = ['嗯', '呃', '啊', '那个', '就是说'] as const

// `like` and `you know` are ordinary words in many sentences, so they only
// count when punctuation sets them off. `um`, `uh`, and `er` have no everyday
// prose use and are removed whenever they stand as a token.
const AMBIGUOUS_FILLER_PATTERN = /(?:^|(?<=[，,；;：:]))\s*(like|you\s+know)\s*(?=[，,；;：:。.!?！？]|$)/gid
const UNAMBIGUOUS_FILLER_PATTERN = /\b(?:um|uh|er)\b/gi

interface FillerMatch {
  start: number
  end: number
}

function chineseFillerMatches(text: string): FillerMatch[] {
  const matches: FillerMatch[] = []
  for (const filler of CHINESE_FILLERS) {
    for (const span of findLiteralSpans(text, filler)) {
      const before = text[span.start - 1]
      const after = text[span.end]
      const beforeOk = before === undefined || (!HAN.test(before) && !/[A-Za-z0-9_]/.test(before))
      const afterOk = after === undefined || (!HAN.test(after) && !/[A-Za-z0-9_]/.test(after))
      if (beforeOk && afterOk) matches.push(span)
    }
  }
  return matches
}

function fillerMatches(text: string): FillerMatch[] {
  const matches = chineseFillerMatches(text)
  for (const match of text.matchAll(UNAMBIGUOUS_FILLER_PATTERN)) {
    if (match.index === undefined) continue
    matches.push({ start: match.index, end: match.index + match[0].length })
  }
  for (const match of text.matchAll(AMBIGUOUS_FILLER_PATTERN)) {
    const span = match.indices?.[1]
    if (span) matches.push({ start: span[0], end: span[1] })
  }
  return matches
}

function joinerBetween(text: string, leftIndex: number, rightIndex: number): string {
  const left = text[leftIndex]
  const right = text[rightIndex]
  return left !== undefined && right !== undefined && HAN.test(left) && HAN.test(right) ? '' : ' '
}

function removeFiller(text: string, match: FillerMatch): string {
  const left = previousNonSpace(text, match.start)
  const right = nextNonSpace(text, match.end)

  // A leading filler takes the sentence's opening capital with it. Drop the
  // whole adjacent separator run (an ellipsis, `?!`, `……`, ...), not one mark,
  // or the result would start with dangling punctuation.
  if (isLeadingPosition(text, match.start)) {
    let end = match.end
    while (end < text.length && isSpace(text[end])) end += 1
    end = separatorRunEnd(text, end)
    while (end < text.length && isSpace(text[end])) end += 1
    return text.slice(0, match.start) + text.slice(end)
  }

  const leftIsComma = left >= 0 && COMMA_SEPARATORS.has(text[left] ?? '')
  const rightIsComma = right >= 0 && COMMA_SEPARATORS.has(text[right] ?? '')

  if (leftIsComma && rightIsComma) {
    const replacement = joinerBetween(text, left - 1, right + 1)
    return text.slice(0, left) + replacement + text.slice(right + 1)
  }
  if (leftIsComma) {
    return text.slice(0, left) + text.slice(match.end)
  }
  if (rightIsComma) {
    return text.slice(0, match.start) + text.slice(right + 1)
  }

  // A filler that ends its own sentence: drop the filler and its whole
  // separator run, but keep the mark that already ended the previous sentence.
  if (right >= 0 && SENTENCE_SEPARATORS.has(text[right] ?? '')) {
    let start = match.start
    while (start > 0 && isSpace(text[start - 1])) start -= 1
    const runEnd = separatorRunEnd(text, right)
    if (left >= 0 && SENTENCE_SEPARATORS.has(text[left] ?? '')) {
      return text.slice(0, start) + text.slice(runEnd)
    }
    // The filler followed a word: keep one mark to terminate the sentence.
    return text.slice(0, start) + text.slice(right, right + 1)
  }

  // A filler at the very end without its own mark.
  if (right < 0) {
    let start = match.start
    while (start > 0 && isSpace(text[start - 1])) start -= 1
    return text.slice(0, start)
  }

  let start = match.start
  let end = match.end
  if (isSpace(text[end])) end += 1
  else if (isSpace(text[start - 1])) start -= 1
  return text.slice(0, start) + text.slice(end)
}

export function removeFillers(text: string): RuleResult {
  let output = text
  let removedLeading = false
  // Matches are disjoint and processed right-to-left, so every earlier offset
  // stays valid while the text shrinks.
  const matches = fillerMatches(output).sort((a, b) => b.start - a.start)
  for (const match of matches) {
    if (isLeadingPosition(output, match.start)) removedLeading = true
    output = removeFiller(output, match)
  }
  return { text: normalizeSpacing(output), removedLeading }
}

/* ------------------------------------------------------------------ */
/* Repetition collapse                                                 */
/* ------------------------------------------------------------------ */

// Legitimate AA reduplications in Chinese. A two-character run from this list
// is kept; a three-or-more run still collapses, because that reads as a stutter.
const KEEP_REDUPLICATIONS = new Set([
  '谢谢', '看看', '想想', '试试', '说说', '问问', '听听', '走走', '坐坐', '等等',
  '妈妈', '爸爸', '哥哥', '姐姐', '弟弟', '妹妹', '叔叔', '舅舅', '姑姑', '奶奶',
  '爷爷', '姥姥', '娃娃', '宝宝', '星星', '刚刚', '慢慢', '好好', '多多', '天天',
  '年年', '人人', '处处', '时时', '常常', '渐渐', '轻轻', '深深', '静静', '明明',
  '白白', '微微', '淡淡', '远远', '高高', '大大', '小小', '快快', '早早', '久久',
  '细细', '紧紧', '牢牢', '偏偏', '恰恰', '通通', '统统', '样样', '件件', '次次',
  '声声', '字字', '句句', '步步', '层层', '片片', '朵朵', '条条', '本本', '张张',
  '乖乖', '亲亲', '抱抱', '玩玩', '唱唱', '跳跳', '跑跑', '转转', '歇歇', '尝尝',
  '闻闻', '摸摸', '碰碰', '擦擦', '洗洗', '睡睡'
])

// Laughter and interjections are legitimately repeated; collapsing them
// changes what the speaker typed.
const KEEP_REPEATED_CHARS = new Set(['哈', '呵', '嘿', '嘻'])

// English doubles that are grammatical rather than a stutter.
const KEEP_REPEATED_TOKENS = new Set(['had', 'that'])

/* ------------------------------------------------------------------ */
/* Sentence-initial casing                                             */
/* ------------------------------------------------------------------ */

/**
 * Restore the capital that a dropped leading filler or correction took with
 * it. Only the first Latin letter of the result is considered: a CJK start, a
 * digit, or a protected/code-like token leaves the text alone, and nothing
 * after the first letter is ever touched, so inner casing cannot be damaged.
 * The caller runs this only when a rule actually removed leading material.
 */
export function restoreSentenceCase(text: string): string {
  let index = 0
  while (index < text.length) {
    const char = text[index] ?? ''
    if (/\s/.test(char) || LEADING_TRANSPARENT.has(char)) {
      index += 1
      continue
    }
    break
  }

  const first = text[index]
  if (first === undefined) return text
  // A placeholder means the sentence starts with text the rules must not edit.
  if (isMaskStart(first)) return text
  if (!LATIN.test(first)) return text

  const upper = first.toUpperCase()
  if (upper === first) return text
  return text.slice(0, index) + upper + text.slice(index + 1)
}

export function collapseRepetitions(text: string, hanThreshold: number): string {
  let output = text.replace(
    /\b([A-Za-z]+)((?:\s+\1\b)+)/gi,
    (whole: string, word: string, tail: string) => {
      const run = 1 + tail.trim().split(/\s+/).length
      // A repeated Latin word is never grammatical prose, so it collapses at
      // two regardless of the Han threshold. `had had` / `that that` remain
      // guarded by the keep set.
      if (run < 2) return whole
      if (KEEP_REPEATED_TOKENS.has(word.toLowerCase())) return whole
      return word
    }
  )

  output = output.replace(/([一-鿿])\1+/g, (whole: string, char: string) => {
    if (whole.length < hanThreshold) return whole
    if (KEEP_REPEATED_CHARS.has(char)) return whole
    // The keep list is retained for a future lower floor; with the current
    // floor of 3, every two-character reduplication already survives.
    if (whole.length === 2 && KEEP_REDUPLICATIONS.has(whole)) return whole
    return char
  })

  // Punctuation runs are atomic and preserved; only filler/self-correction
  // removal may consume one, so there is deliberately no punctuation collapse.
  return output
}
