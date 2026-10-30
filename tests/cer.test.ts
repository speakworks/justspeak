import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeWav } from '../src/core/asr/wav'
import {
  aggregateByTag,
  alignCer,
  decodePcm16Wav,
  parseRealManifest,
  percentile,
  readRealManifest,
  type SampleMetric
} from '../scripts/bench-real'

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'justspeak-real-bench-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('CER alignment', () => {
  it('reports zero errors for identical normalized text', () => {
    const result = alignCer('今天天气很好。', '今天天气很好')
    expect(result.cer).toBe(0)
    expect(result.substitutions).toBe(0)
    expect(result.deletions).toBe(0)
    expect(result.insertions).toBe(0)
    expect(result.diff).toBe('今天天气很好')
  })

  it('counts a substitution and shows the aligned pair', () => {
    const result = alignCer('今天天气很好', '今天天气很坏')
    expect(result.substitutions).toBe(1)
    expect(result.deletions).toBe(0)
    expect(result.insertions).toBe(0)
    expect(result.cer).toBeCloseTo(1 / 6, 6)
    expect(result.diff).toContain('[好→坏]')
  })

  it('counts deletions when the hypothesis is shorter', () => {
    const result = alignCer('你好世界', '你好')
    expect(result.deletions).toBe(2)
    expect(result.substitutions).toBe(0)
    expect(result.insertions).toBe(0)
    expect(result.cer).toBeCloseTo(0.5, 6)
    expect(result.diff).toBe('你好[-世][-界]')
  })

  it('counts insertions when the hypothesis is longer', () => {
    const result = alignCer('你好', '你好世界')
    expect(result.insertions).toBe(2)
    expect(result.substitutions).toBe(0)
    expect(result.deletions).toBe(0)
    expect(result.cer).toBeCloseTo(1, 6)
    expect(result.diff).toBe('你好[+世][+界]')
  })

  it('normalizes case, whitespace, and punctuation', () => {
    const result = alignCer('Hello, world!', '  hello   world  ')
    expect(result.cer).toBe(0)
    expect(result.normalizedReference).toBe('helloworld')
  })

  it('keeps the error total equal to substitutions + deletions + insertions', () => {
    const result = alignCer('语音识别测试', '语音测试识别')
    expect(result.distance).toBe(result.substitutions + result.deletions + result.insertions)
    expect(result.cer).toBeCloseTo(result.distance / result.normalizedReference.length, 6)
  })

  it('reconstructs both strings from the alignment operations', () => {
    const result = alignCer('这是语音识别测试', '这是语音测试')
    const reference = result.operations
      .filter((operation) => operation.kind !== 'insertion')
      .map((operation) => operation.reference ?? '')
      .join('')
    const hypothesis = result.operations
      .filter((operation) => operation.kind !== 'deletion')
      .map((operation) => operation.hypothesis ?? operation.reference ?? '')
      .join('')
    expect(reference).toBe(result.normalizedReference)
    expect(hypothesis).toBe(result.normalizedHypothesis)
  })

  it('handles empty references without dividing by zero', () => {
    expect(alignCer('', '').cer).toBe(0)
    expect(alignCer('', '多余').cer).toBe(1)
  })
})

describe('real manifest validation', () => {
  const validSample = {
    id: 'quiet-zh-short-01',
    path: 'quiet-zh-short-01.wav',
    text: '今天天气很好。',
    tags: { environment: 'quiet', language: 'zh', length: 'short' }
  }

  it('treats a missing manifest as the empty state', async () => {
    const dir = await tempDir()
    expect(await readRealManifest(path.join(dir, 'manifest.json'))).toBeNull()
  })

  it('parses a valid manifest', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'manifest.json')
    await writeFile(file, JSON.stringify({ samples: [validSample] }))
    const manifest = await readRealManifest(file)
    expect(manifest?.samples).toHaveLength(1)
    expect(manifest?.samples[0].tags.environment).toBe('quiet')
  })

  it('rejects invalid JSON', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'manifest.json')
    await writeFile(file, '{ not json')
    await expect(readRealManifest(file)).rejects.toThrow(/not valid JSON/)
  })

  it('rejects a manifest without a samples array', () => {
    expect(() => parseRealManifest({})).toThrow(/samples must be an array/)
  })

  it('rejects a sample missing a required field', () => {
    expect(() =>
      parseRealManifest({
        samples: [{ ...validSample, text: undefined }]
      })
    ).toThrow(/text must be a non-empty string/)
  })

  it('rejects incomplete tags', () => {
    expect(() =>
      parseRealManifest({
        samples: [{ ...validSample, tags: { environment: 'quiet', language: 'zh' } }]
      })
    ).toThrow(/tags.length/)
  })

  it('rejects duplicate ids', () => {
    expect(() =>
      parseRealManifest({ samples: [validSample, validSample] })
    ).toThrow(/duplicate sample id/)
  })

  it('rejects paths that escape bench/real', () => {
    expect(() =>
      parseRealManifest({ samples: [{ ...validSample, path: '../voice.wav' }] })
    ).toThrow(/stay inside bench\/real/)
    expect(() =>
      parseRealManifest({ samples: [{ ...validSample, path: '/tmp/voice.wav' }] })
    ).toThrow(/stay inside bench\/real/)
  })
})

describe('real WAV validation', () => {
  it('decodes canonical 16 kHz mono PCM16', () => {
    const decoded = decodePcm16Wav(encodeWav(new Int16Array(1600)), {
      requireCanonicalHeader: true
    })
    expect(decoded.headerBytes).toBe(44)
    expect(decoded.sampleRate).toBe(16000)
    expect(decoded.durationMs).toBeCloseTo(100, 6)
  })

  it('rejects the wrong sample rate', () => {
    expect(() =>
      decodePcm16Wav(encodeWav(new Int16Array(800), 8000), {
        requireCanonicalHeader: true
      })
    ).toThrow(/16000 Hz mono PCM16/)
  })

  it('rejects a non-canonical header for real samples only', () => {
    const bytes = encodeWav(new Int16Array(1600))
    // Insert a 12-byte LIST chunk before `data`, as converters often do.
    const chunk = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 0x61, 0x62, 0x63, 0x64])
    const shifted = new Uint8Array(bytes.byteLength + chunk.length)
    shifted.set(bytes.subarray(0, 36), 0)
    shifted.set(chunk, 36)
    shifted.set(bytes.subarray(36), 36 + chunk.length)
    new DataView(shifted.buffer).setUint32(4, bytes.byteLength - 8 + chunk.length, true)

    expect(decodePcm16Wav(shifted).headerBytes).toBe(56)
    expect(() =>
      decodePcm16Wav(shifted, { requireCanonicalHeader: true })
    ).toThrow(/must start at byte 44/)
  })

  it('rejects an empty data chunk', () => {
    expect(() => decodePcm16Wav(encodeWav(new Int16Array(0)))).toThrow(/no frames/)
  })
})

describe('tag rollups', () => {
  function metric(
    id: string,
    environment: string,
    cer: number,
    latencyMs: number,
    error?: string
  ): SampleMetric {
    return {
      id,
      path: `${id}.wav`,
      tags: { environment, language: 'zh', length: 'short' },
      durationMs: 4000,
      stopToFinalMs: error ? null : latencyMs,
      wallMs: error ? null : latencyMs,
      rtf: error ? null : latencyMs / 4000,
      detectedLanguage: error ? null : 'zh',
      cer: error ? null : cer,
      errorBreakdown: error
        ? null
        : { substitutions: 0, deletions: 0, insertions: 0, distance: 0 },
      alignedDiff: error ? null : '',
      referenceCharacters: error ? null : 10,
      error
    }
  }

  it('computes interpolated percentiles', () => {
    expect(percentile([], 0.5)).toBeNaN()
    expect(percentile([5], 0.95)).toBe(5)
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(percentile([1, 2, 3, 4], 0.95)).toBeCloseTo(3.85, 6)
  })

  it('groups by every tag dimension and excludes failed samples', () => {
    const metrics = [
      metric('a', 'quiet', 0, 100),
      metric('b', 'quiet', 0.1, 200),
      metric('c', 'quiet', 0.2, 300),
      metric('d', 'quiet', 0.3, 400),
      metric('e', 'quiet', 0.4, 1000),
      metric('f', 'noisy', 0.5, 900),
      metric('g', 'noisy', 0, 0, 'transcription failed')
    ]
    const rollups = aggregateByTag(metrics)
    const quiet = rollups.find(
      (rollup) => rollup.dimension === 'environment' && rollup.value === 'quiet'
    )
    const noisy = rollups.find(
      (rollup) => rollup.dimension === 'environment' && rollup.value === 'noisy'
    )

    expect(quiet).toMatchObject({
      samples: 5,
      meanCer: 0.2,
      p50LatencyMs: 300,
      p95LatencyMs: 880
    })
    expect(noisy).toMatchObject({ samples: 1, meanCer: 0.5 })
    expect(rollups.filter((rollup) => rollup.dimension === 'language')).toHaveLength(1)
    expect(rollups.filter((rollup) => rollup.dimension === 'length')).toHaveLength(1)
  })
})
