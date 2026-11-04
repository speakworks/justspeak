/**
 * Generate a synthetic TTS dataset for the LLM cleanup evaluation smoke run.
 *
 *   pnpm llm:eval:smoke
 *   JUSTSPEAK_LLM_EVAL_DIR=bench/llm/smoke \
 *     JUSTSPEAK_LLM_MODEL=/path/to/model.gguf pnpm llm:eval
 *
 * This is **not** the Go/No-Go dataset: `say` audio is synthetic and cannot
 * stand in for the owner's real dictation. It exists to exercise the full
 * ASR → rules → LLM → metrics chain (and to keep the harness honest when the
 * model is missing or not ready). Output is gitignored under `bench/llm/`.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavInfo } from '../src/core/asr/wav'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'bench/llm/smoke')
const VOICE = process.env.JUSTSPEAK_SMOKE_VOICE ?? 'Tingting'

interface SmokeSample {
  name: string
  /** What the TTS voice says, including the spoken self-correction. */
  spoken: string
  /** What the speaker finally meant; this is the CER reference. */
  reference: string
}

const SAMPLES: SmokeSample[] = [
  { name: 'self-correction-01', spoken: '周一发，不对，周二发。', reference: '周二发。' },
  { name: 'self-correction-02', spoken: '买苹果，不对，买香蕉。', reference: '买香蕉。' },
  { name: 'self-correction-03', spoken: '十点开会，我是说，十一点。', reference: '十一点。' },
  { name: 'ellipsis-01', spoken: '他说……不对，走了。', reference: '他说……走了。' },
  { name: 'negative-01', spoken: '这个不对。', reference: '这个不对。' },
  { name: 'mixed-01', spoken: '用 JustSpeak 记一下，no wait，用 Notion 记一下。', reference: '用 Notion 记一下。' },
  { name: 'name-01', spoken: '找张伟，不对，找张薇。', reference: '找张薇。' },
  { name: 'number-01', spoken: '三点开会，不对，是四点。', reference: '四点开会。' },
  { name: 'commitment-01', spoken: '我不会签，不对，我会签。', reference: '我会签。' },
  { name: 'plain-01', spoken: '明天下午把报告发给李老师。', reference: '明天下午把报告发给李老师。' }
]

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(
      `${command} failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`
    )
  }
}

function main(): void {
  if (process.platform !== 'darwin') {
    throw new Error('the smoke generator uses macOS `say` and `afconvert`')
  }
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  const temporary = path.join(OUT_DIR, '.synthesis.aiff')

  for (const sample of SAMPLES) {
    const wav = path.join(OUT_DIR, `${sample.name}.wav`)
    // This macOS `say` only supports -v/-o/-f; afconvert does the format work.
    run('say', ['-v', VOICE, '-o', temporary, sample.spoken])
    run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', temporary, wav])
    const info = readWavInfo(readFileSync(wav))
    if (info.sampleRate !== 16000 || info.channels !== 1 || info.bitsPerSample !== 16) {
      throw new Error(
        `${sample.name}.wav is ${info.sampleRate} Hz / ${info.channels} ch / ` +
          `${info.bitsPerSample}-bit, not 16 kHz mono PCM16`
      )
    }
    writeFileSync(path.join(OUT_DIR, `${sample.name}.txt`), `${sample.reference}\n`)
  }
  rmSync(temporary, { force: true })

  console.log(`Generated ${SAMPLES.length} synthetic samples in ${OUT_DIR}`)
  console.log('This is a pipeline smoke, not the Go/No-Go dataset.')
  console.log(
    'Run: JUSTSPEAK_LLM_EVAL_DIR=bench/llm/smoke JUSTSPEAK_LLM_MODEL=/path/to/model.gguf pnpm llm:eval'
  )
}

main()
