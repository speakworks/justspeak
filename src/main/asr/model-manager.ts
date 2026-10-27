import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { ModelFileEntry } from '../../core/asr/model-catalog'

export interface ModelManagerDeps {
  fetch: typeof fetch
  stat: typeof stat
  mkdir: typeof mkdir
  rename: typeof rename
  unlink: typeof unlink
  open: typeof open
}

export interface VerifyResult {
  ok: boolean
  sha256: string
  sizeBytes: number
  expectedSha256: string
  expectedSizeBytes: number
}

export class ModelVerificationError extends Error {
  readonly code = 'MODEL_LOAD_FAILED'
  readonly result: VerifyResult

  constructor(message: string, result: VerifyResult) {
    super(message)
    this.name = 'ModelVerificationError'
    this.result = result
  }
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

export async function verifyModelFile(file: string, entry: ModelFileEntry): Promise<VerifyResult> {
  const info = await stat(file)
  const digest = await sha256File(file)
  return {
    ok: info.size === entry.sizeBytes && digest === entry.sha256,
    sha256: digest,
    sizeBytes: info.size,
    expectedSha256: entry.sha256,
    expectedSizeBytes: entry.sizeBytes
  }
}

export interface DownloadProgress {
  bytes: number
  totalBytes: number
}

export interface DownloadOptions {
  onProgress?: (progress: DownloadProgress) => void
  signal?: AbortSignal
}

/**
 * Download to a sibling `.part` file, hash while streaming, verify both size
 * and SHA-256, then rename atomically. A mismatch never reaches the final path.
 */
export async function downloadModelFile(
  entry: ModelFileEntry,
  destination: string,
  options: DownloadOptions = {},
  deps: Partial<ModelManagerDeps> = {}
): Promise<VerifyResult> {
  const fetchImpl = deps.fetch ?? fetch
  const mkdirImpl = deps.mkdir ?? mkdir
  const renameImpl = deps.rename ?? rename
  const unlinkImpl = deps.unlink ?? unlink
  const openImpl = deps.open ?? open

  await mkdirImpl(path.dirname(destination), { recursive: true })
  const partial = `${destination}.part`
  await unlinkImpl(partial).catch(() => {})

  const response = await fetchImpl(entry.url, { redirect: 'follow', signal: options.signal })
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed: HTTP ${response.status}`)
  }

  const hash = createHash('sha256')
  let bytes = 0
  const handle = await openImpl(partial, 'w')

  try {
    for await (const chunk of Readable.fromWeb(
      response.body as unknown as import('node:stream/web').ReadableStream
    )) {
      const buffer = Buffer.from(chunk as Uint8Array)
      bytes += buffer.byteLength
      if (bytes > entry.sizeBytes) {
        throw new ModelVerificationError('Model download exceeded the pinned size', {
          ok: false,
          sha256: '',
          sizeBytes: bytes,
          expectedSha256: entry.sha256,
          expectedSizeBytes: entry.sizeBytes
        })
      }
      hash.update(buffer)
      await handle.write(buffer)
      options.onProgress?.({ bytes, totalBytes: entry.sizeBytes })
    }
  } catch (error) {
    await handle.close().catch(() => {})
    await unlinkImpl(partial).catch(() => {})
    if (error instanceof ModelVerificationError) throw error
    throw new Error(
      `Model download failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }

  await handle.close()
  const digest = hash.digest('hex')
  const result: VerifyResult = {
    ok: bytes === entry.sizeBytes && digest === entry.sha256,
    sha256: digest,
    sizeBytes: bytes,
    expectedSha256: entry.sha256,
    expectedSizeBytes: entry.sizeBytes
  }

  if (!result.ok) {
    await unlinkImpl(partial).catch(() => {})
    throw new ModelVerificationError(
      `Model verification failed: expected ${entry.sizeBytes} bytes / ${entry.sha256}, got ${bytes} bytes / ${digest}`,
      result
    )
  }

  await renameImpl(partial, destination)
  return result
}

export class ModelManager {
  private readonly deps: Partial<ModelManagerDeps>

  constructor(deps: Partial<ModelManagerDeps> = {}) {
    this.deps = deps
  }

  verify(file: string, entry: ModelFileEntry): Promise<VerifyResult> {
    return verifyModelFile(file, entry)
  }

  download(
    entry: ModelFileEntry,
    destination: string,
    options: DownloadOptions = {}
  ): Promise<VerifyResult> {
    return downloadModelFile(entry, destination, options, this.deps)
  }
}
