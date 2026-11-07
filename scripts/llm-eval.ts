/**
 * Evaluate rule-only vs rule + LLM correction on real recordings.
 *
 *   node --import tsx scripts/llm-eval.ts
 *   JUSTSPEAK_ASR=sensevoice node --import tsx scripts/llm-eval.ts
 *
 * Place each recording under `bench/llm/real/` as `<name>.wav` (16 kHz mono
 * PCM16) with a human reference `<name>.txt`. The script refuses to invent a
 * dataset: with no recordings it prints the SOP and exits 0.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { postprocess } from '../src/core/postprocess'
import { readWavInfo } from '../src/core/asr/wav'
import type { AudioInput } from '../src/core/asr/types'
import { MODEL_CATALOG } from '../src/main/asr/catalog'
import { buildProvider } from '../src/main/asr/providers'
import { LlmCorrector } from '../src/main/llm/corrector'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** `JUSTSPEAK_LLM_EVAL_DIR` lets the TTS smoke run use its own directory. */
const REAL_DIR = process.env.JUSTSPEAK_LLM_EVAL_DIR
  ? path.resolve(process.env.JUSTSPEAK_LLM_EVAL_DIR)
  : path.join(ROOT, 'bench/llm/real')
const REPORT_DIR = path.join(ROOT, 'bench/llm/reports')
const MODEL_PATH = process.env.JUSTSPEAK_LLM_MODEL ?? ''

function decodeWav(bytes: Buffer): AudioInput {
  const info = readWavInfo(bytes)
  // The decoder below assumes exactly the SOP's format. Scoring a 48 kHz
  // stereo float file as if it were 16 kHz mono would produce a meaningless
  // CER, so reject it instead of silently reinterpreting bytes.
  if (info.sampleRate !== 16000 || info.channels !== 1 || info.bitsPerSample !== 16) {
    throw new Error(
      `unsupported WAV: ${info.sampleRate} Hz, ${info.channels} channel(s), ` +
        `${info.bitsPerSample}-bit (need 16 kHz mono PCM16)`
    )
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const pcm = new Int16Array(info.dataBytes / 2)
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = view.getInt16(info.dataOffset + i * 2, true)
  return { pcm, sampleRate: 16000, channels: 1, durationMs: info.durationMs }
}

function normalize(text: string): string {
  return [...text.replace(/\s+/g, '')]
    .filter((char) => !/[，。！？、；：,.!?;:…—"'“”‘’()（）]/.test(char))
    .join('')
}

/** Levenshtein distance over Unicode code points. */
function editDistance(a: string, b: string): number {
  const left = [...a]
  const right = [...b]
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1)
      )
    }
    previous = current
  }
  return previous[right.length] ?? 0
}

function cer(reference: string, hypothesis: string): number {
  const ref = normalize(reference)
  if (ref.length === 0) return hypothesis.length === 0 ? 0 : 1
  return editDistance(ref, normalize(hypothesis)) / ref.length
}

function numberSequences(text: string): string[] {
  return text.match(/\p{Nd}+/gu) ?? []
}

async function main(): Promise<void> {
  if (!existsSync(REAL_DIR)) {
    console.log(`No recordings at ${REAL_DIR}.`)
    console.log('See docs/LLM-EVAL-SOP.md; expected <name>.wav + <name>.txt pairs.')
    return
  }
  const wavs = readdirSync(REAL_DIR).filter((file) => file.endsWith('.wav')).sort()
  if (wavs.length === 0) {
    console.log(`No .wav recordings in ${REAL_DIR}. See docs/LLM-EVAL-SOP.md.`)
    return
  }
  if (!MODEL_PATH || !existsSync(MODEL_PATH)) {
    console.error('Set JUSTSPEAK_LLM_MODEL to the local GGUF path for this comparison.')
    process.exit(1)
  }

  const mode = process.env.JUSTSPEAK_ASR === 'qwen3' ? 'qwen3' : 'sensevoice'
  const built = buildProvider({
    mode,
    appRoot: ROOT,
    modelsDir: path.join(ROOT, 'models'),
    catalog: MODEL_CATALOG
  })
  if (!built.ok) throw new Error(built.message)
  if (built.mode === 'fake') throw new Error('LLM eval requires a real ASR provider')
  await built.provider.prepare(built.descriptor)
  const provider = built.provider

  const corrector = new LlmCorrector({
    runtimePath: process.env.JUSTSPEAK_LLM_RUNTIME ?? path.join(ROOT, 'resources/llm/llama-server'),
    localModelPath: MODEL_PATH,
    keyStore: { load: async () => undefined },
    // Scoring is a continuous run: a gap between fixtures must never reclaim
    // the sidecar and silently score the rule text against itself.
    localIdleTimeoutMs: 0
  })
  corrector.configure({ backend: 'local', baseUrl: '', model: '' })
  // The corrector deliberately does not block dictation on a cold model. The
  // evaluator must: scoring before llama-server is healthy would compare the
  // rule output against itself and report "no corrections".
  const ready = await corrector.warmup()
  if (!ready) {
    throw new Error(
      `local LLM did not become ready: ${corrector.localStatus.error ?? 'unknown error'}. ` +
        'Check JUSTSPEAK_LLM_RUNTIME / resources/llm/llama-server and JUSTSPEAK_LLM_MODEL.'
    )
  }

  const rows: Array<Record<string, unknown>> = []
  try {
    for (const wav of wavs) {
      const base = wav.slice(0, -4)
      const referencePath = path.join(REAL_DIR, `${base}.txt`)
      if (!existsSync(referencePath)) {
        console.warn(`skip ${wav}: missing ${base}.txt`)
        continue
      }
      const reference = readFileSync(referencePath, 'utf8').trim()
      const audio = decodeWav(readFileSync(path.join(REAL_DIR, wav)))
      const asrStarted = Date.now()
      const result = await provider.transcribe(audio, { timeoutMs: 180_000 })
      const asrMs = Date.now() - asrStarted
      if (!result.ok) {
        console.warn(`skip ${wav}: ${result.error.message}`)
        continue
      }
      const ruleText = postprocess(result.value.text).text
      const llmStarted = Date.now()
      const refined = await corrector.refine(ruleText)
      const llmMs = Date.now() - llmStarted
      const llmText = refined?.text ?? ruleText
      // Compare against the human reference, not rule-vs-LLM: the deterministic
      // guard already makes the latter tautological.
      const referenceNumbers = numberSequences(reference)
      const llmNumbers = numberSequences(llmText)
      rows.push({
        file: wav,
        reference,
        asr: result.value.text,
        rule: ruleText,
        llm: llmText,
        cerAsr: cer(reference, result.value.text),
        cerRule: cer(reference, ruleText),
        cerLlm: cer(reference, llmText),
        decision: refined?.outcome ?? 'no_candidate',
        numbersPreserved:
          referenceNumbers.length === 0
            ? null
            : referenceNumbers.join('|') === llmNumbers.join('|'),
        changed: refined?.corrected ?? false,
        asrMs,
        llmMs
      })
    }
  } finally {
    await corrector.dispose()
    await provider.dispose()
  }

  if (rows.length === 0) {
    console.error('No samples evaluated.')
    process.exit(1)
  }
  const mean = (key: 'cerAsr' | 'cerRule' | 'cerLlm'): number =>
    rows.reduce((sum, row) => sum + (row[key] as number), 0) / rows.length
  const withNumbers = rows.filter((row) => row.numbersPreserved !== null)
  const fallback = rows.filter((row) => row.decision === 'deferred').length
  const noCandidate = rows.filter((row) => row.decision === 'no_candidate').length
  const summary = {
    generatedAt: new Date().toISOString(),
    asrMode: mode,
    localModelReady: true,
    samples: rows.length,
    noCandidate,
    noCandidateRate: rows.length === 0 ? 0 : noCandidate / rows.length,
    cerAsr: mean('cerAsr'),
    cerRule: mean('cerRule'),
    cerLlm: mean('cerLlm'),
    changed: rows.filter((row) => row.changed).length,
    // `deferred` includes model uncertainty, timeouts, malformed output and
    // transport failures; the SOP's No-Go threshold uses this rate.
    fallback,
    fallbackRate: rows.length === 0 ? 0 : fallback / rows.length,
    numbersPreserved: withNumbers.filter((row) => row.numbersPreserved).length,
    samplesWithNumbers: withNumbers.length,
    decisions: rows.reduce<Record<string, number>>((counts, row) => {
      const key = String(row.decision)
      counts[key] = (counts[key] ?? 0) + 1
      return counts
    }, {}),
    rows
  }
  mkdirSync(REPORT_DIR, { recursive: true })
  // Date-only names overwrite a second run on the same day (for example the
  // SenseVoice baseline after a Qwen3 comparison), so keep time + ASR mode.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const report = path.join(REPORT_DIR, `${stamp}-${mode}.json`)
  writeFileSync(report, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(
    JSON.stringify({
      samples: summary.samples,
      cer_asr: summary.cerAsr,
      cer_rule: summary.cerRule,
      cer_llm: summary.cerLlm,
      changed: summary.changed,
      no_candidate: summary.noCandidate,
      fallback: summary.fallback,
      fallback_rate: summary.fallbackRate,
      numbers_preserved: summary.numbersPreserved,
      samples_with_numbers: summary.samplesWithNumbers,
      report
    })
  )
}

main().catch((error) => {
  console.error(`llm-eval: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
