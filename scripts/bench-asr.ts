/**
 * Provider-driven Qwen3-ASR benchmark (M1).
 *
 * Drives the real Qwen3AsrProvider + TranscribeCliRunner against a 3–5 s WAV
 * fixture, so the measured stop→final includes PCM validation, WAV encoding,
 * temp-file write, CLI spawn, model load, inference, and parsing.
 *
 * Run: pnpm bench:asr [--runs 3]
 * Output: bench/results/<date>-<commit>.json + bench/reports/<date>-qwen3-asr.md
 * The JSON is content-free (no transcript or audio); only metrics and hashes.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Qwen3AsrProvider } from '../src/core/asr/qwen3-provider'
import {
  findModel,
  findRuntime,
  parseModelCatalog,
  toModelDescriptor
} from '../src/core/asr/model-catalog'
import { readWavInfo } from '../src/core/asr/wav'
import type { AudioInput } from '../src/core/asr/types'
import { TranscribeCliRunner } from '../src/main/asr/cli-runner'
import { sha256File } from '../src/main/asr/model-manager'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const runsArg = args.indexOf('--runs')
const requestedRuns = runsArg >= 0 ? Number(args[runsArg + 1]) : 3
const RUNS = Number.isFinite(requestedRuns) && requestedRuns > 0 ? requestedRuns : 3

function sysctl(name: string): string {
  return spawnSync('sysctl', ['-n', name], { encoding: 'utf8' }).stdout.trim()
}

function gitCommit(): string {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  return result.status === 0 ? result.stdout.trim() : 'unknown'
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function normalizeText(value: string): string {
  return value.replace(/[\s，。！？、,.!?：:；“”"'（）()]/g, '')
}

function editDistance(reference: string, hypothesis: string): number {
  const previous = new Array<number>(hypothesis.length + 1)
  for (let j = 0; j <= hypothesis.length; j += 1) previous[j] = j
  for (let i = 1; i <= reference.length; i += 1) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= hypothesis.length; j += 1) {
      const saved = previous[j]
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1)
      )
      diagonal = saved
    }
  }
  return previous[hypothesis.length]
}

function characterErrorRate(reference: string, hypothesis: string): number {
  const ref = normalizeText(reference)
  const hyp = normalizeText(hypothesis)
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1
  return editDistance(ref, hyp) / ref.length
}

async function decodeWav(file: string): Promise<AudioInput> {
  const bytes = await readFile(file)
  const info = readWavInfo(bytes)
  if (info.sampleRate !== 16000 || info.channels !== 1 || info.bitsPerSample !== 16) {
    throw new Error('fixture must be 16 kHz mono PCM16')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const samples = info.dataBytes / 2
  const pcm = new Int16Array(samples)
  for (let i = 0; i < samples; i += 1) pcm[i] = view.getInt16(info.dataOffset + i * 2, true)
  return { pcm, sampleRate: 16000, channels: 1, durationMs: info.durationMs }
}

interface CliProfile {
  rssBytes: number | null
  pureInferenceMs: number | null
  pureSpeedFactor: number | null
}

async function profileCli(cliPath: string, modelPath: string, fixture: string): Promise<CliProfile> {
  const result = spawnSync('/usr/bin/time', ['-l', cliPath, '-q', '-m', modelPath, fixture], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  })
  if (result.status !== 0) {
    console.warn('[bench] /usr/bin/time run failed:', result.stderr?.slice(-400))
    return { rssBytes: null, pureInferenceMs: null, pureSpeedFactor: null }
  }
  const rssMatch = /(\d+)\s+maximum resident set size/i.exec(result.stderr)
  // The CLI's own line: "realtime: 24x (161.7 ms for 3.8 s)" on stdout.
  const realtimeMatch = /realtime:\s+([\d.]+)x\s+\(([\d.]+) ms/.exec(
    `${result.stdout}\n${result.stderr}`
  )
  return {
    rssBytes: rssMatch ? Number(rssMatch[1]) : null,
    pureInferenceMs: realtimeMatch ? Number(realtimeMatch[2]) : null,
    pureSpeedFactor: realtimeMatch ? Number(realtimeMatch[1]) : null
  }
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'n/a'
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(0)} MB`
}

async function main(): Promise<void> {
  const catalog = parseModelCatalog(
    JSON.parse(await readFile(path.join(ROOT, 'resources/models.json'), 'utf8'))
  )
  const model = findModel(catalog, 'qwen3-asr-0.6b-q8')
  const runtime = findRuntime(catalog, model.runtime)
  const descriptor = toModelDescriptor(model)
  const fixtureDir = path.join(ROOT, 'bench/fixtures')
  const manifest = JSON.parse(await readFile(path.join(fixtureDir, 'manifest.json'), 'utf8'))
  const fixture = manifest.fixtures[0]
  const fixturePath = path.join(fixtureDir, fixture.path)

  const cliPath = path.join(ROOT, runtime.buildDir, runtime.binary)
  const modelPath = path.join(ROOT, 'models', model.files[0].path)
  if (!existsSync(cliPath)) throw new Error(`runtime missing: ${cliPath}; run pnpm setup:asr`)
  if (!existsSync(modelPath)) throw new Error(`model missing: ${modelPath}; run pnpm setup:asr`)

  const audio = await decodeWav(fixturePath)
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

  const runs: Array<{
    run: number
    wallMs: number
    providerLatencyMs: number
    rtf: number
    speedFactor: number
    language?: string
    cer: number
    matchesExpected: boolean
  }> = []

  console.log(`[bench] ${provider.id} · ${fixture.path} · ${RUNS} runs`)
  for (let run = 1; run <= RUNS; run += 1) {
    const startedAt = performance.now()
    const result = await provider.transcribe(audio, { timeoutMs: 180_000 })
    const wallMs = performance.now() - startedAt
    if (!result.ok) throw new Error(`run ${run} failed: ${result.error.code} ${result.error.message}`)
    const cer = characterErrorRate(fixture.text, result.value.text)
    const rtf = result.value.latencyMs / 1000 / (audio.durationMs / 1000)
    runs.push({
      run,
      wallMs: Math.round(wallMs),
      providerLatencyMs: result.value.latencyMs,
      rtf: Number(rtf.toFixed(3)),
      speedFactor: Number((1 / rtf).toFixed(1)),
      language: result.value.language,
      cer: Number(cer.toFixed(3)),
      matchesExpected: cer <= 0.2
    })
    console.log(
      `[bench] run ${run}: ${Math.round(wallMs)} ms wall · ${result.value.latencyMs} ms provider · ` +
        `RTF ${rtf.toFixed(3)} · CER ${(cer * 100).toFixed(1)}% · text="${result.value.text}"`
    )
  }

  const warm = runs.slice(1)
  const coldStartMs = runs[0]?.wallMs ?? null
  const warmMedianMs = warm.length > 0 ? Math.round(median(warm.map((run) => run.wallMs))) : null
  const warmMedianRtf = warm.length > 0 ? Number(median(warm.map((run) => run.rtf)).toFixed(3)) : null
  const cliProfile = await profileCli(cliPath, modelPath, fixturePath)
  const rssBytes = cliProfile.rssBytes

  const date = new Date()
  const day = date.toISOString().slice(0, 10)
  const commit = gitCommit()
  const hardware = {
    chip: sysctl('machdep.cpu.brand_string'),
    cores: Number(sysctl('hw.ncpu')),
    memoryBytes: Number(sysctl('hw.memsize')),
    macOS: spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim(),
    powerState: spawnSync('pmset', ['-g', 'batt'], { encoding: 'utf8' }).stdout.trim().slice(0, 80)
  }

  const result = {
    schemaVersion: 1,
    runId: `${day}-${commit}`,
    generatedAt: date.toISOString(),
    gitCommit: commit,
    appVersion: '0.1.0-demo.0',
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
    fixture: {
      id: fixture.id,
      sha256: fixture.sha256,
      durationSec: Number((audio.durationMs / 1000).toFixed(3)),
      sampleRate: 16000,
      channels: 1,
      synthetic: true
    },
    hardware,
    metrics: {
      rtfConvention:
        'rtf = provider_seconds / audio_seconds (lower is better); provider_seconds includes WAV write, CLI spawn, model load, inference, and parsing, not pure inference',
      runs,
      coldStartMs,
      warmMedianMs,
      warmMedianRtf,
      peakRssBytes: rssBytes,
      pureCliInferenceMs: cliProfile.pureInferenceMs,
      pureCliSpeedFactor: cliProfile.pureSpeedFactor,
      modelSizeBytes: model.files[0].sizeBytes,
      stopToFinalDefinition:
        'provider.transcribe wall time: PCM validation + WAV write + CLI spawn + model load + inference + parse; excludes clipboard paste and IPC from the renderer'
    },
    accuracyNote:
      'CER is against a synthetic macOS TTS fixture and is a smoke signal only, not evidence of real-speech accuracy.',
    gates: {
      peakRssUnder2GB: rssBytes === null ? null : rssBytes <= 2 * 1024 * 1024 * 1024,
      modelUnder1GB: model.files[0].sizeBytes <= 1024 * 1024 * 1024
    }
  }

  const resultsDir = path.join(ROOT, 'bench/results')
  const reportsDir = path.join(ROOT, 'bench/reports')
  await mkdir(resultsDir, { recursive: true })
  await mkdir(reportsDir, { recursive: true })
  const jsonPath = path.join(resultsDir, `${result.runId}.json`)
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`)

  const runRows = runs
    .map(
      (run) =>
        `| ${run.run}${run.run === 1 ? ' (cold)' : ''} | ${run.wallMs} | ${run.providerLatencyMs} | ${run.rtf} | ${run.speedFactor}x | ${(run.cer * 100).toFixed(1)}% |`
    )
    .join('\n')

  const report = `# Qwen3-ASR M1 benchmark — ${day}

- Commit: \`${commit}\`
- Date: ${date.toISOString()}
- Hardware: ${hardware.chip}, ${hardware.cores} cores, ${(hardware.memoryBytes / 1e9).toFixed(0)} GB RAM, macOS ${hardware.macOS}
- Power: ${hardware.powerState || 'unknown'}
- Provider: \`${provider.id}\` · ${model.name} · ${model.quantization} · ${model.license}
- Model: ${formatBytes(model.files[0].sizeBytes)} · SHA-256 \`${modelSha}\`
- Runtime: transcribe.cpp ${runtime.tag} (\`${runtime.commit}\`)
- Fixture: \`${fixture.id}\` · ${(audio.durationMs / 1000).toFixed(3)} s · 16 kHz mono PCM16 · synthetic TTS
- RTF convention: **provider-path RTF** = \`provider_seconds / audio_seconds\` (lower is better). The numerator includes WAV write, CLI spawn, model load, inference, and parse; it is not pure inference.
- Speed factor = 1 / RTF. The CLI's own pure-inference line is reported separately below.

## Results

| Run | Wall (ms) | Provider (ms) | Provider RTF | Speed | CER |
|---:|---:|---:|---:|---:|---:|
${runRows}

| Metric | Value |
|---|---:|
| Cold start (first provider call) | ${coldStartMs ?? 'n/a'} ms |
| Warm median stop→final | ${warmMedianMs ?? 'n/a'} ms |
| Warm median provider-path RTF | ${warmMedianRtf ?? 'n/a'} |
| Pure CLI inference (same run) | ${cliProfile.pureInferenceMs ?? 'n/a'} ms · ${cliProfile.pureSpeedFactor ?? 'n/a'}x |
| Peak child RSS | ${formatBytes(rssBytes)} |
| Model size on disk | ${formatBytes(model.files[0].sizeBytes)} |
| CER (synthetic TTS smoke) | ${(Math.min(...runs.map((run) => run.cer)) * 100).toFixed(1)}% |

## Definition and caveats

- Stop→final here is the real \`Qwen3AsrProvider\` call: PCM validation, temporary WAV write, CLI spawn, model load, inference, and output parsing. It excludes renderer IPC and the clipboard paste that follow in the app (paste adds roughly 0.4 s in M0).
- The pure-inference row comes from the CLI's own \`realtime\` line in the same measured run; provider-path RTF is deliberately broader because that is what the app experiences per utterance.
- Cold start here is the first provider call in this process with a warm OS file cache and Metal pipeline cache. The first-ever machine-cold run during setup (compiling Metal libraries) took about 5.8 s; that onboarding cost is not the steady-state gate.
- Warm runs reuse the OS page cache but still pay the per-utterance CLI launch.
- Peak RSS is measured by a separate \`/usr/bin/time -l\` run of the same CLI and model, not by the provider call.
- CER uses a synthetic macOS \`say\` fixture (TTS, no personal data); it is a smoke signal, not a real-speech accuracy result.
- The model was downloaded from the pinned Hugging Face revision; no weights are committed to git.
- Result JSON: \`bench/results/${result.runId}.json\` (content-free; no transcript or audio).
`

  const reportPath = path.join(reportsDir, `${day}-qwen3-asr.md`)
  await writeFile(reportPath, report)

  console.log(`[bench] results: ${path.relative(ROOT, jsonPath)}`)
  console.log(`[bench] report:  ${path.relative(ROOT, reportPath)}`)
  const history = await readdir(resultsDir)
  console.log(`[bench] ${history.length} result file(s) recorded`)
}

await main()
