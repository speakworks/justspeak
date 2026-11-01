import { HISTORY_OUTCOMES } from '../../shared/ipc'
import type { HistoryAudioRef, HistoryEntry, HistoryOutcome } from '../../shared/ipc'

/**
 * Dictation history: pure parsing, grouping and ordering.
 *
 * The file format is one JSON object per line. JSON escapes newlines inside
 * `text`, so a transcript that itself contains blank lines still occupies
 * exactly one line — a truncated write can therefore only damage one record.
 * Invalid lines are skipped instead of failing the whole read: a hand-edited
 * file or an interrupted append must never hide the rest of the history.
 */

export function isHistoryOutcome(value: unknown): value is HistoryOutcome {
  return typeof value === 'string' && (HISTORY_OUTCOMES as readonly string[]).includes(value)
}

/** The largest timestamp `Date` can represent, so the renderer never throws. */
const MAX_TIMESTAMP = 8_640_000_000_000_000

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * One line in, one entry out. Unknown extra keys are ignored so a newer writer
 * can add fields without making older readers discard the record; a missing or
 * mistyped required field returns `null` and the caller counts it as skipped.
 */
export function parseHistoryLine(line: string): HistoryEntry | null {
  const trimmed = line.trim()
  if (trimmed === '') return null

  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>

  const id = nonEmptyString(record.id)
  const text = typeof record.text === 'string' ? record.text : null
  const createdAt = finiteNumber(record.createdAt)
  const durationMs = finiteNumber(record.durationMs)
  const latencyMs = finiteNumber(record.latencyMs)
  if (id === null || text === null || createdAt === null) return null
  if (createdAt > MAX_TIMESTAMP) return null
  if (durationMs === null || latencyMs === null) return null
  if (!isHistoryOutcome(record.outcome)) return null

  const entry: HistoryEntry = {
    id,
    text,
    createdAt,
    outcome: record.outcome,
    fake: record.fake === true,
    durationMs,
    latencyMs
  }

  const audio = record.audio
  if (typeof audio === 'object' && audio !== null && !Array.isArray(audio)) {
    const ref = audio as Record<string, unknown>
    const file = nonEmptyString(ref.file)
    const bytes = finiteNumber(ref.bytes)
    if (file !== null && bytes !== null) entry.audio = { file, bytes }
  }

  return entry
}

/** Read a whole history file. `skipped` is the number of unusable lines. */
export function parseHistory(raw: string): { entries: HistoryEntry[]; skipped: number } {
  const entries: HistoryEntry[] = []
  let skipped = 0
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const entry = parseHistoryLine(line)
    if (entry === null) skipped += 1
    else entries.push(entry)
  }
  return { entries, skipped }
}

/** One JSON object plus the newline that makes appends line-safe. */
export function serializeHistoryEntry(entry: HistoryEntry): string {
  return `${JSON.stringify(entry)}\n`
}

export function removeHistoryEntry(
  entries: readonly HistoryEntry[],
  id: string
): HistoryEntry[] {
  return entries.filter((entry) => entry.id !== id)
}

/** `HH:MM` in the user's local time. */
export function formatHistoryTime(createdAt: number): string {
  const date = new Date(createdAt)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Recording length as one decimal place, e.g. `3.2s`. */
export function formatHistoryDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`
}

/** Local calendar date, not UTC: history groups what the user experienced. */
export function localDateKey(createdAt: number): string {
  const date = new Date(createdAt)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Whole calendar days between two instants, ignoring time of day and DST. */
function calendarDaysBetween(then: number, now: number): number {
  const a = new Date(then)
  const b = new Date(now)
  const aUtc = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const bUtc = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((bUtc - aUtc) / 86_400_000)
}

export function localDateLabel(createdAt: number, now = Date.now()): string {
  const days = calendarDaysBetween(createdAt, now)
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  const date = new Date(createdAt)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/**
 * Retention, taken from the plan card's frozen decisions: text keeps the newest
 * 1000 entries or 30 days, whichever binds first; audio is kept for the newest
 * 500 entries only. Dropping audio never drops the text row.
 */
export interface HistoryRetention {
  maxEntries: number
  maxAgeMs: number
  maxAudioEntries: number
}

export const DEFAULT_HISTORY_RETENTION: HistoryRetention = {
  maxEntries: 1000,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxAudioEntries: 500
}

export interface HistoryRetentionPlan {
  /** Surviving entries, newest first, with over-limit audio refs removed. */
  kept: HistoryEntry[]
  /** Entries removed entirely; their audio goes too. */
  removed: HistoryEntry[]
  /** Audio files to delete while the text row survives. */
  audioDropped: HistoryAudioRef[]
}

/**
 * Decide what survives. Pure: deleting files and rewriting the file are the
 * store's job. Entries are ordered by `createdAt` here, so callers may pass
 * the file's natural append order.
 */
export function planHistoryRetention(
  entries: readonly HistoryEntry[],
  now = Date.now(),
  limits: HistoryRetention = DEFAULT_HISTORY_RETENTION
): HistoryRetentionPlan {
  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt)
  const cutoff = now - limits.maxAgeMs
  const fresh = sorted.filter((entry) => entry.createdAt >= cutoff)
  const stale = sorted.filter((entry) => entry.createdAt < cutoff)
  const keepCount = Math.max(0, limits.maxEntries)
  // Position, not id: a hand-edited duplicate id must not exempt a row from
  // the count cap.
  const keptSlice = fresh.slice(0, keepCount)
  const removed = [...fresh.slice(keepCount), ...stale]

  const audioDropped: HistoryAudioRef[] = []
  let audioKept = 0
  const kept = keptSlice.map((entry) => {
    if (entry.audio === undefined) return entry
    audioKept += 1
    if (audioKept <= Math.max(0, limits.maxAudioEntries)) return entry
    audioDropped.push(entry.audio)
    const { audio: _dropped, ...withoutAudio } = entry
    return withoutAudio
  })

  return { kept, removed, audioDropped }
}

export interface HistoryDateGroup {
  /** `YYYY-MM-DD`, stable across locale changes; used as the React key. */
  key: string
  /** Human label: 今天 / 昨天 / 2026年10月30日. */
  label: string
  entries: HistoryEntry[]
}

/**
 * Newest first, grouped by local day. Input order is irrelevant; two entries
 * written in the same millisecond keep their file order because `sort` is
 * stable in V8.
 */
export function groupHistoryByDate(
  entries: readonly HistoryEntry[],
  now = Date.now()
): HistoryDateGroup[] {
  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt)
  const groups = new Map<string, HistoryDateGroup>()
  for (const entry of sorted) {
    const key = localDateKey(entry.createdAt)
    let group = groups.get(key)
    if (group === undefined) {
      group = { key, label: localDateLabel(entry.createdAt, now), entries: [] }
      groups.set(key, group)
    }
    group.entries.push(entry)
  }
  return [...groups.values()]
}
