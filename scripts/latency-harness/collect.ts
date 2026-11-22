/**
 * Turns a folder of recordings into the Phase 0 grid.
 *
 * The grid is 20 recordings × 3 output routes. Two facts shape everything here:
 *
 * - The input-side segments (endpoint, ASR final, LLM first token) do not
 *   depend on which speaker the audio leaves through, so each recording is
 *   measured once and its numbers are copied into its three route rows.
 * - The output-side segment (TTS first packet) does depend on the route, so it
 *   is measured once per route and applied to that route's 20 rows.
 *
 * That asymmetry is stated in the report rather than smoothed over: a reader
 * who assumes 60 independent measurements would otherwise think the table says
 * more than it does. Anything not measured stays `待填` / `blocked` — the grid
 * exists to be filled by observation, not by arithmetic on guesses.
 */
import {
  TARGET_RECORDINGS,
  TARGET_ROUTES,
  type SegmentResult,
  blockedSegment,
  measuredSegment
} from './report'
import { summarize } from './stats'

export type RouteLabel = (typeof TARGET_ROUTES)[number]

export const RECORDING_DIR = 'bench/fixtures/recordings'
export const RECORDING_NAME_PATTERN = 'rec-01.wav … rec-20.wav（两位段号，16 kHz 单声道 PCM16）'

export interface RecordingRef {
  recId: string
  index: number
  fileName: string
}

export interface DiscoveryResult {
  recordings: RecordingRef[]
  problems: string[]
}

export function recordingFileName(index: number): string {
  return `rec-${String(index).padStart(2, '0')}.wav`
}

/** Null for anything that is not `rec-NN.wav`; the caller decides whether that is a problem. */
export function parseRecordingFileName(fileName: string): RecordingRef | null {
  const match = /^rec-(\d{2})\.wav$/i.exec(fileName)
  if (!match) return null
  const index = Number(match[1])
  if (!Number.isInteger(index) || index < 1) return null
  return { recId: recordingFileName(index).slice(0, -4), index, fileName }
}

/**
 * Sorts valid names and reports the ones that would silently fall out of the
 * grid. A `.wav` that does not match the pattern is a problem, not a no-op:
 * dropping it without a word is how a table ends up claiming coverage it never
 * had.
 */
export function discoverRecordings(fileNames: readonly string[]): DiscoveryResult {
  const problems: string[] = []
  const byIndex = new Map<number, RecordingRef>()

  for (const fileName of fileNames) {
    if (!fileName.toLowerCase().endsWith('.wav')) continue
    const parsed = parseRecordingFileName(fileName)
    if (parsed === null) {
      problems.push(`命名不合规，已忽略：${fileName}（应为 ${RECORDING_NAME_PATTERN}）`)
      continue
    }
    if (parsed.index > TARGET_RECORDINGS) {
      problems.push(`段号超出 Phase 0 范围，已忽略：${fileName}（最大 rec-${TARGET_RECORDINGS}）`)
      continue
    }
    const existing = byIndex.get(parsed.index)
    if (existing) {
      problems.push(`段号重复，保留 ${existing.fileName} 并忽略 ${fileName}`)
      continue
    }
    byIndex.set(parsed.index, parsed)
  }

  const recordings = [...byIndex.values()].sort((a, b) => a.index - b.index)
  for (let index = 1; index <= TARGET_RECORDINGS; index += 1) {
    if (!byIndex.has(index)) problems.push(`缺失 ${recordingFileName(index)}`)
  }
  return { recordings, problems }
}

export function parseRouteList(raw: string): RouteLabel[] {
  const parts = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const routes = parts.map((value) => {
    if (!(TARGET_ROUTES as readonly string[]).includes(value)) {
      throw new Error(`未知路由 "${value}"；只能是 ${TARGET_ROUTES.join(' / ')}`)
    }
    return value as RouteLabel
  })
  if (routes.length === 0) throw new Error('至少需要一条路由')
  return [...new Set(routes)]
}

export interface RowMeasurements {
  endpoint: SegmentResult
  asrFinal: SegmentResult
  llmFirstToken: SegmentResult
  ttsFirstPacket: SegmentResult
}

export interface CollectRow extends RowMeasurements {
  recId: string
  route: RouteLabel
  /** Sum of the four P50s, and only when all four were measured. */
  m1: SegmentResult
}

export function buildRow(recId: string, route: RouteLabel, measurements: RowMeasurements): CollectRow {
  const parts = [
    measurements.endpoint,
    measurements.asrFinal,
    measurements.llmFirstToken,
    measurements.ttsFirstPacket
  ]
  const allMeasured = parts.every((part) => part.status === 'measured' && part.summary !== null)
  const m1 = allMeasured
    ? measuredSegment([parts.reduce((total, part) => total + (part.summary?.p50Ms ?? 0), 0)], {
        definition: '端点 + ASR 终稿 + LLM 首 token + TTS 首包 四个 P50 之和',
        note: '算术和，不是真人听感的 M1；上机后必须用听感校准值覆盖'
      })
    : skippedSegmentForM1(parts)
  return { recId, route, ...measurements, m1 }
}

function skippedSegmentForM1(parts: readonly SegmentResult[]): SegmentResult {
  const blocked = parts.find((part) => part.status === 'blocked')
  return blockedSegment(
    `无法合成 M1：${blocked ? `有环节 blocked（${blocked.reason}）` : '有环节 skipped'}`
  )
}

function cell(segment: SegmentResult | undefined): string {
  if (segment === undefined) return '待填'
  if (segment.status === 'measured' && segment.summary) return String(segment.summary.p50Ms)
  return segment.status
}

export function buildTable(rows: readonly CollectRow[]): string {
  const index = new Map<string, CollectRow>()
  for (const row of rows) index.set(`${row.recId}|${row.route}`, row)
  const lines: string[] = []
  for (let recording = 1; recording <= TARGET_RECORDINGS; recording += 1) {
    const recId = recordingFileName(recording).slice(0, -4)
    for (const route of TARGET_ROUTES) {
      const row = index.get(`${recId}|${route}`)
      lines.push(
        `| ${recId} | ${route} | ${cell(row?.endpoint)} | ${cell(row?.asrFinal)} | ` +
          `${cell(row?.llmFirstToken)} | ${cell(row?.ttsFirstPacket)} | ${cell(row?.m1)} |`
      )
    }
  }
  return lines.join('\n')
}

export interface Coverage {
  recordings: number
  routes: number
  /** Rows in the 20 × 3 grid; one row per recording × route. */
  gridRows: number
  /** Rows actually produced by this run. */
  rows: number
  /** Measurement columns filled by observation, out of gridRows × 4. */
  measuredColumns: number
  blockedColumns: number
  /** Grid rows with no row at all: the recording file is absent. */
  missingRows: number
  complete: boolean
}

export function coverageOf(rows: readonly CollectRow[]): Coverage {
  const recordings = new Set(rows.map((row) => row.recId)).size
  const routes = new Set(rows.map((row) => row.route)).size
  let measuredColumns = 0
  let blockedColumns = 0
  for (const row of rows) {
    for (const part of [row.endpoint, row.asrFinal, row.llmFirstToken, row.ttsFirstPacket]) {
      if (part.status === 'measured') measuredColumns += 1
      else blockedColumns += 1
    }
  }
  const gridRows = TARGET_RECORDINGS * TARGET_ROUTES.length
  return {
    recordings,
    routes,
    gridRows,
    rows: rows.length,
    measuredColumns,
    blockedColumns,
    missingRows: Math.max(0, gridRows - rows.length),
    complete: rows.length >= gridRows && measuredColumns === gridRows * 4
  }
}

/**
 * Pools the rows' samples back into one segment per column, so the §f.1 and
 * §f.3 gate can read a single P50 without pretending a blocked row is a zero.
 */
export function aggregateColumns(rows: readonly CollectRow[]): RowMeasurements {
  return {
    endpoint: aggregate(rows.map((row) => row.endpoint), 'endpoint'),
    asrFinal: aggregate(rows.map((row) => row.asrFinal), 'asrFinal'),
    llmFirstToken: aggregate(rows.map((row) => row.llmFirstToken), 'llmFirstToken'),
    ttsFirstPacket: aggregate(rows.map((row) => row.ttsFirstPacket), 'ttsFirstPacket')
  }
}

function aggregate(parts: readonly SegmentResult[], key: string): SegmentResult {
  const samples = parts.filter((part) => part.status === 'measured').flatMap((part) => part.samplesMs)
  if (samples.length === 0) {
    const reason = parts.find((part) => part.status === 'blocked')?.reason
    return blockedSegment(
      reason ?? `所有行都未产出 ${key} 样本`,
      { rows: parts.length, measuredRows: 0 }
    )
  }
  const summary = summarize(samples)
  return measuredSegment(samples, {
    rows: parts.length,
    measuredRows: parts.filter((part) => part.status === 'measured').length,
    pooledP95Ms: summary?.p95Ms ?? null
  })
}
