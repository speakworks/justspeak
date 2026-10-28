import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findModel, parseModelCatalog, toModelDescriptor } from '../src/core/asr/model-catalog'
import { Qwen3AsrProvider } from '../src/core/asr/qwen3-provider'
import { SenseVoiceAsrProvider } from '../src/core/asr/sensevoice-provider'
import type { AudioInput } from '../src/core/asr/types'
import { encodeWav, readWavInfo } from '../src/core/asr/wav'
import { TranscribeCliRunner } from '../src/main/asr/cli-runner'
import { resolveAsrPaths } from '../src/main/asr/paths'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const enabled = process.env.JUSTSPEAK_REAL_ASR === '1'
const suite = enabled ? describe : describe.skip

function decodeWav(bytes: Buffer): AudioInput {
  const info = readWavInfo(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const pcm = new Int16Array(info.dataBytes / 2)
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = view.getInt16(info.dataOffset + i * 2, true)
  return { pcm, sampleRate: 16000, channels: 1, durationMs: info.durationMs }
}

suite('real pinned Qwen3 CLI smoke', () => {
  let provider: Qwen3AsrProvider
  let tempDir: string

  beforeAll(async () => {
    const catalog = parseModelCatalog(
      JSON.parse(readFileSync(path.join(ROOT, 'resources/models.json'), 'utf8'))
    )
    const model = findModel(catalog, 'qwen3-asr-0.6b-q8')
    const paths = resolveAsrPaths(ROOT, catalog)
    const runner = new TranscribeCliRunner({
      cliPath: paths.cliPath,
      modelPath: paths.modelPath,
      defaultTimeoutMs: 180_000
    })
    provider = new Qwen3AsrProvider({
      model: toModelDescriptor(model),
      runner,
      defaultTimeoutMs: 180_000
    })
    await provider.prepare(toModelDescriptor(model))
    tempDir = await mkdtemp(path.join(tmpdir(), 'justspeak-smoke-'))
  })

  afterAll(async () => {
    await provider?.dispose()
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  it('transcribes the committed 3–5 s fixture to Chinese text', async () => {
    const fixture = path.join(ROOT, 'bench/fixtures/zh-4s.wav')
    const audio = decodeWav(readFileSync(fixture))
    const result = await provider.transcribe(audio, { timeoutMs: 180_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.text.length).toBeGreaterThan(0)
    expect(result.value.text).toContain('语音识别')
    expect(result.value.language).toBe('zh')
  })

  it('maps real silence to empty text instead of inventing words', async () => {
    const silencePath = path.join(tempDir, 'silence.wav')
    const wav = encodeWav(new Int16Array(16000))
    await writeFile(silencePath, wav)
    const audio = decodeWav(Buffer.from(wav))
    const result = await provider.transcribe(audio, { timeoutMs: 180_000 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.text).toBe('')
  })
})

const SENSEVOICE_MODEL = path.join(
  ROOT,
  'models/sensevoice-small/SenseVoiceSmall-Q8_0.gguf'
)
const sensevoiceSuite =
  enabled && existsSync(SENSEVOICE_MODEL) ? describe : describe.skip

sensevoiceSuite('real pinned SenseVoice CLI smoke', () => {
  let provider: SenseVoiceAsrProvider

  beforeAll(async () => {
    const catalog = parseModelCatalog(
      JSON.parse(readFileSync(path.join(ROOT, 'resources/models.json'), 'utf8'))
    )
    const model = findModel(catalog, 'sensevoice-small-q8')
    const paths = resolveAsrPaths(ROOT, catalog, {}, 'sensevoice')
    const runner = new TranscribeCliRunner({
      cliPath: paths.cliPath,
      modelPath: paths.modelPath,
      modelId: model.id,
      label: model.name,
      defaultTimeoutMs: 180_000
    })
    provider = new SenseVoiceAsrProvider({
      model: toModelDescriptor(model),
      runner,
      defaultTimeoutMs: 180_000
    })
    await provider.prepare(toModelDescriptor(model))
  })

  afterAll(async () => {
    await provider?.dispose()
  })

  it('transcribes the committed Chinese fixture', async () => {
    const audio = decodeWav(readFileSync(path.join(ROOT, 'bench/fixtures/zh-4s.wav')))
    const result = await provider.transcribe(audio, { timeoutMs: 180_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.text).toContain('语音识别')
    expect(result.value.language).toBe('zh')
    expect(result.value.modelId).toBe('sensevoice-small-q8')
  })

  it('gates digital silence to empty text instead of the model hallucination', async () => {
    // Without the provider gate the pinned build returns "그。" for this input.
    const audio = decodeWav(Buffer.from(encodeWav(new Int16Array(16000))))
    const result = await provider.transcribe(audio, { timeoutMs: 180_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.text).toBe('')
    expect(result.value.warnings.map((w) => w.code)).toEqual(['NO_SPEECH'])
  })
})
