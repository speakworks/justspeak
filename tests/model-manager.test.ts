import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelFileEntry } from '../src/core/asr/model-catalog'
import {
  downloadModelFile,
  ModelVerificationError,
  sha256File,
  verifyModelFile
} from '../src/main/asr/model-manager'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'justspeak-model-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function entryFor(payload: Uint8Array): ModelFileEntry {
  return {
    path: 'model.gguf',
    url: 'https://example.test/model.gguf',
    sha256: createHash('sha256').update(payload).digest('hex'),
    sizeBytes: payload.byteLength
  }
}

describe('model verification', () => {
  it('hashes a file with SHA-256', async () => {
    const file = path.join(dir, 'payload.bin')
    const payload = Buffer.from('justspeak')
    await writeFile(file, payload)
    expect(await sha256File(file)).toBe(createHash('sha256').update(payload).digest('hex'))
  })

  it('accepts a matching size and digest', async () => {
    const payload = Buffer.from('model-bytes')
    const file = path.join(dir, 'model.gguf')
    await writeFile(file, payload)
    const result = await verifyModelFile(file, entryFor(payload))
    expect(result.ok).toBe(true)
  })

  it('rejects a digest mismatch', async () => {
    const payload = Buffer.from('model-bytes')
    const file = path.join(dir, 'model.gguf')
    await writeFile(file, payload)
    const entry = { ...entryFor(payload), sha256: '0'.repeat(64) }
    const result = await verifyModelFile(file, entry)
    expect(result.ok).toBe(false)
    expect(result.sha256).not.toBe(entry.sha256)
  })

  it('rejects a size mismatch', async () => {
    const payload = Buffer.from('model-bytes')
    const file = path.join(dir, 'model.gguf')
    await writeFile(file, payload)
    const result = await verifyModelFile(file, { ...entryFor(payload), sizeBytes: 999 })
    expect(result.ok).toBe(false)
  })
})

describe('model download', () => {
  it('streams, verifies, and atomically installs a model', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6])
    const entry = entryFor(payload)
    const destination = path.join(dir, 'models', 'model.gguf')
    const progress: number[] = []

    const result = await downloadModelFile(
      entry,
      destination,
      { onProgress: (p) => progress.push(p.bytes) },
      { fetch: async () => new Response(payload, { status: 200 }) }
    )

    expect(result.ok).toBe(true)
    expect(existsSync(destination)).toBe(true)
    expect(existsSync(`${destination}.part`)).toBe(false)
    expect(new Uint8Array(await readFile(destination))).toEqual(payload)
    expect(progress.at(-1)).toBe(payload.byteLength)
  })

  it('deletes the partial file and throws when the digest differs', async () => {
    const payload = new Uint8Array([1, 2, 3])
    const entry = { ...entryFor(payload), sha256: '1'.repeat(64) }
    const destination = path.join(dir, 'model.gguf')

    await expect(
      downloadModelFile(entry, destination, {}, { fetch: async () => new Response(payload) })
    ).rejects.toBeInstanceOf(ModelVerificationError)

    expect(existsSync(destination)).toBe(false)
    expect(existsSync(`${destination}.part`)).toBe(false)
  })

  it('deletes the partial file on an interrupted stream', async () => {
    const payload = new Uint8Array(32)
    const entry = entryFor(payload)
    const destination = path.join(dir, 'model.gguf')

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.error(new Error('network dropped'))
      }
    })

    await expect(
      downloadModelFile(entry, destination, {}, { fetch: async () => new Response(stream) })
    ).rejects.toThrow(/download failed/i)

    expect(existsSync(destination)).toBe(false)
    expect(existsSync(`${destination}.part`)).toBe(false)
  })

  it('reports HTTP failures without creating a final file', async () => {
    const payload = new Uint8Array([1])
    const destination = path.join(dir, 'model.gguf')
    await expect(
      downloadModelFile(entryFor(payload), destination, {}, {
        fetch: async () => new Response('nope', { status: 503 })
      })
    ).rejects.toThrow(/HTTP 503/)
    expect(existsSync(destination)).toBe(false)
  })

  it('rejects a download larger than the pinned size', async () => {
    const payload = new Uint8Array([1, 2, 3, 4])
    const destination = path.join(dir, 'model.gguf')
    const entry = { ...entryFor(payload), sizeBytes: 2 }
    await expect(
      downloadModelFile(entry, destination, {}, { fetch: async () => new Response(payload) })
    ).rejects.toBeInstanceOf(ModelVerificationError)
    expect(existsSync(destination)).toBe(false)
  })
})
