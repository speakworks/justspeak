/**
 * Real-speech evaluation harness (M1).
 *
 * Scores the pinned Qwen3-ASR provider on recordings a human drops into the
 * gitignored `bench/real/` directory. It shares the provider path and WAV
 * decoding with the synthetic benchmark (`scripts/bench-asr.ts --real`), but
 * emits CER with an aligned error breakdown and per-tag rollups instead of
 * synthetic smoke metrics.
 *
 * Run: pnpm bench:asr --real
 * Output: bench/results/<date>-real.json + bench/reports/<date>-real.md
 * Both outputs are local-only and gitignored: they contain transcript text.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findModel,
  findRuntime,
  parseModelCatalog,
  toModelDescriptor
} from '../src/core/asr/model-catalog'
import {
  PCM_BITS_PER_SAMPLE,
  PCM_CHANNELS,
  PCM_SAMPLE_RATE,
  readWavInfo,
  WAV_HEADER_BYTES
} from '../src/core/asr/wav'
import type { AudioInput } from '../src/core/asr/types'
import { Qwen3AsrProvider } from '../src/core/asr/qwen3-provider'
import { TranscribeCliRunner } from '../src/main/asr/cli-runner'
import { sha256File } from '../src/main/asr/model-manager'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODEL_ID = 'qwen3-asr-0.6b-q8'
const REAL_DIR = path.join(ROOT, 'bench/real')
const MANIFEST_PATH = path.join(REAL_DIR, 'manifest.json')

export type TagDimension = 'environment' | 'language' | 'length'

export const TAG_DIMENSIONS: readonly TagDimension[] = ['environment', 'language', 'length']

export interface RealSampleTags {
  environment: string
  language: string
  length: string
}

export interface RealSample {
  id: string
  path: string
  text: string
  tags: RealSampleTags
}

export interface RealManifest {
  samples: RealSample[]
}

export type AlignOperationKind = 'match' | 'substitution' | 'deletion' | 'insertion'

export interface AlignOperation {
  kind: AlignOperationKind
  reference?: string
  hypothesis?: string
}

export interface CerAlignment {
  normalizedReference: string
  normalizedHypothesis: string
  substitutions: number
  deletions: number
  insertions: number
  distance: number
  cer: number
  operations: AlignOperation[]
  diff: string
}

export interface SampleMetric {
  id: string
  path: string
  tags: RealSampleTags
  durationMs: number | null
  stopToFinalMs: number | null
  wallMs: number | null
  rtf: number | null
  detectedLanguage: string | null
  cer: number | null
  errorBreakdown: {
    substitutions: number
    deletions: number
    insertions: number
    distance: number
  } | null
  alignedDiff: string | null
  referenceCharacters: number | null
  error?: string
}

export interface TagRollup {
  dimension: TagDimension
  value: string
  samples: number
  meanCer: number
  p50LatencyMs: number
  p95LatencyMs: number
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

/**
 * Validate the manifest before touching any audio. Unknown keys are ignored so
 * the format can grow, but every sample must be scoreable and path-contained.
 */
export function parseRealManifest(value: unknown): RealManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('manifest must be a JSON object')
  }
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.samples)) throw new Error('manifest.samples must be an array')

  const seen = new Set<string>()
  const samples = record.samples.map((raw, index): RealSample => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`sample ${index} must be an object`)
    }
    const sample = raw as Record<string, unknown>
    const id = nonEmptyString(sample.id, `sample ${index}.id`)
    if (seen.has(id)) throw new Error(`duplicate sample id: ${id}`)
    seen.add(id)

    const relativePath = nonEmptyString(sample.path, `sample ${id}.path`)
    if (
      path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).includes('..')
    ) {
      throw new Error(`sample ${id}.path must stay inside bench/real (got: ${relativePath})`)
    }

    if (typeof sample.tags !== 'object' || sample.tags === null || Array.isArray(sample.tags)) {
      throw new Error(`sample ${id}.tags must be an object`)
    }
    const tags = sample.tags as Record<string, unknown>

    return {
      id,
      path: relativePath,
      text: nonEmptyString(sample.text, `sample ${id}.text`),
      tags: {
        environment: nonEmptyString(tags.environment, `sample ${id}.tags.environment`),
        language: nonEmptyString(tags.language, `sample ${id}.tags.language`),
        length: nonEmptyString(tags.length, `sample ${id}.tags.length`)
      }
    }
  })

  return { samples }
}

/**
 * A missing manifest is the empty state, not an error: the harness has nothing
 * to measure yet. A malformed manifest is an error and must fail closed.
 */
export async function readRealManifest(file: string): Promise<RealManifest | null> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw cause
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`manifest is not valid JSON: ${file}`)
  }
  return parseRealManifest(parsed)
}

export interface DecodedWav extends AudioInput {
  headerBytes: number
}

function wavFormatTag(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4))
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ') return view.getUint16(offset + 8, true)
    offset += 8 + size + (size % 2)
  }
  return null
}

/**
 * Decode 16 kHz mono PCM16. Real samples additionally require the canonical
 * 44-byte header so a recorder or converter cannot silently change the layout.
 */
export function decodePcm16Wav(
  bytes: Uint8Array,
  options: { requireCanonicalHeader?: boolean } = {}
): DecodedWav {
  const info = readWavInfo(bytes)
  if (
    info.sampleRate !== PCM_SAMPLE_RATE ||
    info.channels !== PCM_CHANNELS ||
    info.bitsPerSample !== PCM_BITS_PER_SAMPLE
  ) {
    throw new Error(
      `audio must be ${PCM_SAMPLE_RATE} Hz mono PCM${PCM_BITS_PER_SAMPLE}; ` +
        `got ${info.sampleRate} Hz, ${info.channels} channel(s), ${info.bitsPerSample}-bit`
    )
  }
  if (wavFormatTag(bytes) !== 1) throw new Error('audio must be PCM (WAV format tag 1)')
  if (options.requireCanonicalHeader && info.dataOffset !== WAV_HEADER_BYTES) {
    throw new Error(
      `WAV data must start at byte ${WAV_HEADER_BYTES}; got ${info.dataOffset}. ` +
        'Re-encode with the afconvert --no-filler command in docs/REAL-SPEECH-SOP.md'
    )
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sampleCount = Math.floor(info.dataBytes / 2)
  if (sampleCount === 0) throw new Error('audio contains no frames')
  const pcm = new Int16Array(sampleCount)
  for (let i = 0; i < sampleCount; i += 1) {
    pcm[i] = view.getInt16(info.dataOffset + i * 2, true)
  }

  return {
    pcm,
    sampleRate: PCM_SAMPLE_RATE,
    channels: PCM_CHANNELS,
    durationMs: info.durationMs,
    headerBytes: info.dataOffset
  }
}

export async function decodeWavFile(
  file: string,
  options: { requireCanonicalHeader?: boolean } = {}
): Promise<DecodedWav> {
  return decodePcm16Wav(await readFile(file), options)
}

// Whitespace, CJK and ASCII punctuation, and a few symbols carry no lexical
// content for Mandarin/English dictation, so they are removed before alignment.
const NON_LEXICAL = /[\s，。！？、,.!?：:；;“”"'‘’（）()\[\]【】{}<>《》…—–\-]/g

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(NON_LEXICAL, '')
}

export function renderAlignedDiff(operations: readonly AlignOperation[]): string {
  return operations
    .map((operation) => {
      switch (operation.kind) {
        case 'match':
          return operation.reference ?? ''
        case 'substitution':
          return `[${operation.reference ?? ''}→${operation.hypothesis ?? ''}]`
        case 'deletion':
          return `[-${operation.reference ?? ''}]`
        case 'insertion':
          return `[+${operation.hypothesis ?? ''}]`
      }
    })
    .join('')
}

/**
 * Character error rate with a Levenshtein backtrace, so a score always comes
 * with substitutions/deletions/insertions and a readable alignment.
 */
export function alignCer(reference: string, hypothesis: string): CerAlignment {
  const ref = normalizeText(reference)
  const hyp = normalizeText(hypothesis)

  const rows = ref.length + 1
  const columns = hyp.length + 1
  const distance = Array.from({ length: rows }, () => new Array<number>(columns).fill(0))
  for (let i = 0; i < rows; i += 1) distance[i][0] = i
  for (let j = 0; j < columns; j += 1) distance[0][j] = j

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      const substitutionCost = ref[i - 1] === hyp[j - 1] ? 0 : 1
      distance[i][j] = Math.min(
        distance[i - 1][j] + 1,
        distance[i][j - 1] + 1,
        distance[i - 1][j - 1] + substitutionCost
      )
    }
  }

  const operations: AlignOperation[] = []
  let i = ref.length
  let j = hyp.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const substitutionCost = ref[i - 1] === hyp[j - 1] ? 0 : 1
      if (distance[i][j] === distance[i - 1][j - 1] + substitutionCost) {
        operations.push(
          substitutionCost === 0
            ? { kind: 'match', reference: ref[i - 1] }
            : { kind: 'substitution', reference: ref[i - 1], hypothesis: hyp[j - 1] }
        )
        i -= 1
        j -= 1
        continue
      }
    }
    if (i > 0 && distance[i][j] === distance[i - 1][j] + 1) {
      operations.push({ kind: 'deletion', reference: ref[i - 1] })
      i -= 1
      continue
    }
    if (j > 0 && distance[i][j] === distance[i][j - 1] + 1) {
      operations.push({ kind: 'insertion', hypothesis: hyp[j - 1] })
      j -= 1
      continue
    }
    throw new Error('alignment failed: no valid backtrace step')
  }
  operations.reverse()

  const substitutions = operations.filter((operation) => operation.kind === 'substitution').length
  const deletions = operations.filter((operation) => operation.kind === 'deletion').length
  const insertions = operations.filter((operation) => operation.kind === 'insertion').length
  const editDistance = substitutions + deletions + insertions
  const cer =
    ref.length === 0 ? (hyp.length === 0 ? 0 : 1) : editDistance / ref.length

  return {
    normalizedReference: ref,
    normalizedHypothesis: hyp,
    substitutions,
    deletions,
    insertions,
    distance: editDistance,
    cer,
    operations,
    diff: renderAlignedDiff(operations)
  }
}

/** Linear-interpolation percentile, matching the usual p50/p95 reporting. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const rank = (sorted.length - 1) * p
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower)
}

export function aggregateByTag(metrics: readonly SampleMetric[]): TagRollup[] {
  const rollups: TagRollup[] = []
  for (const dimension of TAG_DIMENSIONS) {
    const groups = new Map<string, SampleMetric[]>()
    for (const metric of metrics) {
      if (metric.error !== undefined || metric.cer === null) continue
      const value = metric.tags[dimension]
      const group = groups.get(value) ?? []
      group.push(metric)
      groups.set(value, group)
    }
    const sortedGroups = [...groups.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )
    for (const [value, group] of sortedGroups) {
      const latencies = group.map((metric) => metric.stopToFinalMs ?? 0)
      rollups.push({
        dimension,
        value,
        samples: group.length,
        meanCer: round(
          group.reduce((sum, metric) => sum + (metric.cer ?? 0), 0) / group.length,
          4
        ),
        p50LatencyMs: Math.round(percentile(latencies, 0.5)),
        p95LatencyMs: Math.round(percentile(latencies, 0.95))
      })
    }
  }
  return rollups
}

function gitCommit(): string {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  return result.status === 0 ? result.stdout.trim() : 'unknown'
}

function formatPercent(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`
}

function sampleRow(metric: SampleMetric): string {
  const breakdown = metric.errorBreakdown
    ? `${metric.errorBreakdown.substitutions}/${metric.errorBreakdown.deletions}/${metric.errorBreakdown.insertions}`
    : 'n/a'
  return (
    `| ${metric.id} | ${metric.tags.environment} | ${metric.tags.language} | ` +
    `${metric.tags.length} | ${metric.durationMs === null ? 'n/a' : (metric.durationMs / 1000).toFixed(2)} | ` +
    `${metric.stopToFinalMs ?? 'n/a'} | ${metric.rtf ?? 'n/a'} | ` +
    `${metric.detectedLanguage ?? 'n/a'} | ${formatPercent(metric.cer)} | ${breakdown} |`
  )
}

function buildMarkdown(
  day: string,
  commit: string,
  metadata: {
    modelName: string
    modelSha256: string
    runtimeTag: string
    runtimeCommit: string
  },
  metrics: readonly SampleMetric[],
  rollups: readonly TagRollup[]
): string {
  const failed = metrics.filter((metric) => metric.error !== undefined).length
  const scored = metrics.filter((metric) => metric.error === undefined)
  const meanCer =
    scored.length === 0
      ? null
      : scored.reduce((sum, metric) => sum + (metric.cer ?? 0), 0) / scored.length

  const breakdownSections = metrics
    .filter((metric) => metric.error !== undefined || (metric.cer ?? 0) > 0)
    .map((metric) => {
      if (metric.error !== undefined) {
        return `### ${metric.id} — transcription failed\n\n- Error: ${metric.error}`
      }
      const breakdown = metric.errorBreakdown
      const operations = breakdown
        ? `- Substitutions ${breakdown.substitutions} · deletions ${breakdown.deletions} · insertions ${breakdown.insertions}`
        : '- No error breakdown'
      return [
        `### ${metric.id} — CER ${formatPercent(metric.cer)}`,
        '',
        `- Normalized reference length: ${metric.referenceCharacters ?? 'n/a'} characters`,
        operations,
        `- Detected language: ${metric.detectedLanguage ?? 'n/a'}`,
        `- Aligned diff: \`${metric.alignedDiff ?? ''}\``
      ].join('\n')
    })

  const rollupSections = TAG_DIMENSIONS.map((dimension) => {
    const rows = rollups
      .filter((rollup) => rollup.dimension === dimension)
      .map(
        (rollup) =>
          `| ${rollup.value} | ${rollup.samples} | ${formatPercent(rollup.meanCer)} | ${rollup.p50LatencyMs} | ${rollup.p95LatencyMs} |`
      )
    return [
      `### ${dimension}`,
      '',
      '| Value | Samples | Mean CER | p50 latency (ms) | p95 latency (ms) |',
      '|---|---:|---:|---:|---:|',
      ...(rows.length > 0 ? rows : ['| _no scored samples_ | 0 | n/a | n/a | n/a |'])
    ].join('\n')
  })

  return `# Real-speech evaluation — ${day}

- Commit: \`${commit}\`
- Model: ${metadata.modelName} · SHA-256 \`${metadata.modelSha256}\`
- Runtime: transcribe.cpp ${metadata.runtimeTag} (\`${metadata.runtimeCommit}\`)
- Samples: ${metrics.length} (${scored.length} scored, ${failed} failed)
- Mean CER across scored samples: **${formatPercent(meanCer)}**
- Output is **local-only** and gitignored: this report contains transcript text.

## Definitions

- **Stop→final latency** is \`Qwen3AsrProvider.transcribe\` latency: PCM validation, temporary WAV write, CLI spawn, model load, inference, and parsing. It excludes renderer IPC and paste.
- **RTF** = stop→final seconds / audio seconds (provider path, lower is better).
- **CER** = (substitutions + deletions + insertions) / normalized reference characters. Normalization lowercases and removes whitespace, punctuation, and common symbols.
- **p50/p95** use linear interpolation over the per-sample stop→final latencies in that tag.
- Scores are meaningful only for the sample set present. This harness never downloads a model; it reads the pinned entry in \`resources/models.json\`.

## Samples

| ID | Environment | Language | Length | Audio (s) | Stop→final (ms) | RTF | Detected | CER | S/D/I |
|---|---|---|---|---:|---:|---:|---|---:|---|
${metrics.map(sampleRow).join('\n')}

## Error breakdown

${breakdownSections.length > 0 ? breakdownSections.join('\n\n') : 'No errors: every scored sample matched its reference exactly.'}

## Rollups

${rollupSections.join('\n\n')}
`
}

export async function runRealBench(): Promise<void> {
  const manifest = await readRealManifest(MANIFEST_PATH)
  if (!manifest || manifest.samples.length === 0) {
    console.log(
      `[bench-real] no real samples yet — ${path.relative(ROOT, MANIFEST_PATH)} ` +
        'is missing or empty; nothing to measure.'
    )
    console.log('[bench-real] add recordings per docs/REAL-SPEECH-SOP.md, or run the synthetic benchmark with pnpm bench:asr.')
    return
  }

  const catalog = parseModelCatalog(
    JSON.parse(await readFile(path.join(ROOT, 'resources/models.json'), 'utf8'))
  )
  const model = findModel(catalog, MODEL_ID)
  const runtime = findRuntime(catalog, model.runtime)
  const descriptor = toModelDescriptor(model)
  const cliPath = path.join(ROOT, runtime.buildDir, runtime.binary)
  const modelPath = path.join(ROOT, 'models', model.files[0].path)
  if (!existsSync(cliPath)) throw new Error(`runtime missing: ${cliPath}; run pnpm setup:asr`)
  if (!existsSync(modelPath)) throw new Error(`model missing: ${modelPath}; run pnpm setup:asr`)

  const modelSha = await sha256File(modelPath)
  if (modelSha !== model.files[0].sha256) {
    throw new Error(`model SHA-256 mismatch: ${modelSha} != ${model.files[0].sha256}`)
  }

  const runner = new TranscribeCliRunner({
    cliPath,
    modelPath,
    defaultTimeoutMs: 180_000
  })
  const provider = new Qwen3AsrProvider({ model: descriptor, runner })
  await provider.prepare(descriptor)

  const metrics: SampleMetric[] = []
  console.log(`[bench-real] ${provider.id} · ${manifest.samples.length} sample(s) · pinned model ${model.id}`)

  for (const sample of manifest.samples) {
    const file = path.resolve(REAL_DIR, sample.path)
    try {
      const audio = await decodeWavFile(file, { requireCanonicalHeader: true })
      const startedAt = performance.now()
      const result = await provider.transcribe(audio, { timeoutMs: 180_000 })
      const wallMs = Math.round(performance.now() - startedAt)
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)

      const alignment = alignCer(sample.text, result.value.text)
      const rtf = result.value.latencyMs / audio.durationMs
      metrics.push({
        id: sample.id,
        path: sample.path,
        tags: sample.tags,
        durationMs: round(audio.durationMs, 1),
        stopToFinalMs: result.value.latencyMs,
        wallMs,
        rtf: round(rtf, 3),
        detectedLanguage: result.value.language ?? null,
        cer: round(alignment.cer, 4),
        errorBreakdown: {
          substitutions: alignment.substitutions,
          deletions: alignment.deletions,
          insertions: alignment.insertions,
          distance: alignment.distance
        },
        alignedDiff: alignment.diff,
        referenceCharacters: alignment.normalizedReference.length
      })
      console.log(
        `[bench-real] ${sample.id}: ${(audio.durationMs / 1000).toFixed(2)} s · ` +
          `${result.value.latencyMs} ms · RTF ${rtf.toFixed(3)} · CER ${formatPercent(alignment.cer)} · ` +
          `S/D/I ${alignment.substitutions}/${alignment.deletions}/${alignment.insertions} · ` +
          `lang ${result.value.language ?? 'n/a'}`
      )
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      metrics.push({
        id: sample.id,
        path: sample.path,
        tags: sample.tags,
        durationMs: null,
        stopToFinalMs: null,
        wallMs: null,
        rtf: null,
        detectedLanguage: null,
        cer: null,
        errorBreakdown: null,
        alignedDiff: null,
        referenceCharacters: null,
        error: message
      })
      console.warn(`[bench-real] ${sample.id}: ${message}`)
    }
  }

  const rollups = aggregateByTag(metrics)
  const failures = metrics.filter((metric) => metric.error !== undefined).length
  const date = new Date()
  const day = date.toISOString().slice(0, 10)
  const commit = gitCommit()

  const result = {
    schemaVersion: 1,
    runId: `${day}-real`,
    generatedAt: date.toISOString(),
    gitCommit: commit,
    contentSensitive: true,
    provider: {
      id: provider.id,
      modelId: model.id,
      modelName: model.name,
      modelSha256: modelSha,
      modelSizeBytes: model.files[0].sizeBytes,
      license: model.license,
      sourceUrl: model.sourceUrl,
      quantization: model.quantization,
      runtimeId: runtime.id,
      runtimeTag: runtime.tag,
      runtimeCommit: runtime.commit
    },
    normalization: 'lowercase; whitespace, punctuation, and symbols removed before alignment',
    metrics: {
      samples: metrics,
      rollups,
      scoredSamples: metrics.length - failures,
      failedSamples: failures,
      definitions: {
        stopToFinal:
          'Qwen3AsrProvider.transcribe latency: PCM validation + WAV write + CLI spawn + model load + inference + parse; excludes renderer IPC and paste',
        rtf: 'stop_to_final_seconds / audio_seconds (provider path, lower is better)',
        cer: '(substitutions + deletions + insertions) / normalized reference characters',
        percentiles: 'p50/p95 use linear interpolation over per-sample stop-to-final latencies'
      }
    }
  }

  const resultsDir = path.join(ROOT, 'bench/results')
  const reportsDir = path.join(ROOT, 'bench/reports')
  await mkdir(resultsDir, { recursive: true })
  await mkdir(reportsDir, { recursive: true })
  const jsonPath = path.join(resultsDir, `${day}-real.json`)
  const reportPath = path.join(reportsDir, `${day}-real.md`)
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`)
  await writeFile(
    reportPath,
    buildMarkdown(day, commit, {
      modelName: model.name,
      modelSha256: modelSha,
      runtimeTag: runtime.tag,
      runtimeCommit: runtime.commit
    }, metrics, rollups)
  )

  console.log(`[bench-real] results: ${path.relative(ROOT, jsonPath)}`)
  console.log(`[bench-real] report:  ${path.relative(ROOT, reportPath)}`)
  if (failures > 0) {
    console.warn(`[bench-real] ${failures} sample(s) failed; see the report`)
    process.exitCode = 1
  }
}
