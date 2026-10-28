import { findLiteralSpans, type Span } from './vocabulary'

/* ------------------------------------------------------------------ */
/* Masking                                                             */
/* ------------------------------------------------------------------ */

const MASK_START = '\uE000'
const MASK_END = '\uE001'

function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
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

export interface MaskedText {
  masked: string
  restore: (value: string) => string
}

/**
 * Replace spans with private-use placeholders so no rule can edit them, then
 * put the original text back. Placeholder ids stay stable while rules delete
 * or reorder the text around them.
 */
export function maskSpans(text: string, spans: readonly Span[]): MaskedText {
  const merged = mergeSpans(spans)
  if (merged.length === 0) return { masked: text, restore: (value) => value }

  const originals: string[] = []
  let masked = ''
  let cursor = 0
  for (const span of merged) {
    masked += text.slice(cursor, span.start)
    masked += `${MASK_START}${originals.length}${MASK_END}`
    originals.push(text.slice(span.start, span.end))
    cursor = span.end
  }
  masked += text.slice(cursor)

  const pattern = new RegExp(`${MASK_START}(\\d+)${MASK_END}`, 'g')
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
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
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
  ',', '，', ';', '；', ':', '：', '.', '。', '!', '！', '?', '？', '、'
])

const COMMA_SEPARATORS = new Set([',', '，', ';', '；', ':', '：'])

const CJK_SEPARATORS = new Set(['，', '。', '；', '：', '！', '？', '、'])

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
      while (cursor < text.length && isSpace(text[cursor])) cursor += 1
      if (cursor < text.length && SEPARATORS.has(text[cursor] ?? '')) cursor += 1
      while (cursor < text.length && isSpace(text[cursor])) cursor += 1
      const nextMarkerEnd = matchMarkerAt(text, cursor)
      if (nextMarkerEnd === null) break
      deleteEnd = nextMarkerEnd
    }

    while (deleteEnd < text.length && isSpace(text[deleteEnd])) deleteEnd += 1
    if (deleteEnd < text.length && SEPARATORS.has(text[deleteEnd] ?? '')) deleteEnd += 1
    while (deleteEnd < text.length && isSpace(text[deleteEnd])) deleteEnd += 1

    return { start: fragmentStart, end: deleteEnd }
  }

  return null
}

export function applySelfCorrections(text: string): string {
  let output = text
  // A handful of markers can chain ("A, no wait, B, no wait, C"); the bound
  // makes the rule total even on adversarial input.
  for (let pass = 0; pass < 8; pass += 1) {
    const deletion = findCorrectionDeletion(output)
    if (!deletion) break
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
  return normalizeSpacing(output)
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

  let start = match.start
  let end = match.end
  if (isSpace(text[end])) end += 1
  else if (isSpace(text[start - 1])) start -= 1
  return text.slice(0, start) + text.slice(end)
}

export function removeFillers(text: string): string {
  let output = text
  // Matches are disjoint and processed right-to-left, so every earlier offset
  // stays valid while the text shrinks.
  const matches = fillerMatches(output).sort((a, b) => b.start - a.start)
  for (const match of matches) output = removeFiller(output, match)
  return normalizeSpacing(output)
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

export function collapseRepetitions(text: string, threshold: number): string {
  let output = text.replace(
    /\b([A-Za-z]+)((?:\s+\1\b)+)/gi,
    (whole: string, word: string, tail: string) => {
      const run = 1 + tail.trim().split(/\s+/).length
      if (run < threshold) return whole
      if (KEEP_REPEATED_TOKENS.has(word.toLowerCase())) return whole
      return word
    }
  )

  output = output.replace(/([一-鿿])\1+/g, (whole: string, char: string) => {
    if (whole.length < threshold) return whole
    if (KEEP_REPEATED_CHARS.has(char)) return whole
    if (whole.length === 2 && KEEP_REDUPLICATIONS.has(whole)) return whole
    return char
  })

  // Identical punctuation runs collapse; a three-dot ellipsis is intentional
  // prose rather than a duplicate.
  output = output.replace(/([.,，。；;：:！!？?])\1+/g, (whole: string, char: string) =>
    char === '.' && whole.length === 3 ? whole : char
  )

  return output
}
