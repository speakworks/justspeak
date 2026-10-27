import type { AsrCapabilities, AsrModelDescriptor } from './types'

export interface ModelFileEntry {
  path: string
  url: string
  sha256: string
  sizeBytes: number
}

export interface ModelCatalogEntry {
  id: string
  name: string
  version: string
  runtime: string
  files: ModelFileEntry[]
  sizeBytes: number
  license: string
  sourceUrl: string
  quantization: string
  capabilities: AsrCapabilities
}

export interface RuntimeCatalogEntry {
  id: string
  version: string
  tag: string
  commit: string
  sourceUrl: string
  license: string
  buildDir: string
  binary: string
}

export interface ModelCatalog {
  schemaVersion: 1
  models: ModelCatalogEntry[]
  runtimes: RuntimeCatalogEntry[]
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isCapabilities(value: unknown): value is AsrCapabilities {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    Array.isArray(record.languages) &&
    record.languages.every((language) => typeof language === 'string') &&
    typeof record.streaming === 'boolean' &&
    typeof record.punctuation === 'boolean' &&
    typeof record.itn === 'boolean' &&
    typeof record.timestamps === 'boolean' &&
    typeof record.vad === 'boolean' &&
    isPositiveInteger(record.maxAudioMs) &&
    Array.isArray(record.quantizations)
  )
}

/**
 * Validate the embedded catalog before trusting any download URL or digest.
 * A malformed entry must fail closed rather than yield an unverified model.
 */
export function parseModelCatalog(value: unknown): ModelCatalog {
  if (typeof value !== 'object' || value === null) throw new Error('catalog must be an object')
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) throw new Error('unsupported catalog schema')
  if (!Array.isArray(record.models) || record.models.length === 0) {
    throw new Error('catalog has no models')
  }
  if (!Array.isArray(record.runtimes) || record.runtimes.length === 0) {
    throw new Error('catalog has no runtimes')
  }

  const models = record.models.map((raw, index): ModelCatalogEntry => {
    if (typeof raw !== 'object' || raw === null) throw new Error(`model ${index} is not an object`)
    const entry = raw as Record<string, unknown>
    if (
      !isNonEmptyString(entry.id) ||
      !isNonEmptyString(entry.name) ||
      !isNonEmptyString(entry.version) ||
      !isNonEmptyString(entry.runtime) ||
      !isNonEmptyString(entry.license) ||
      !isNonEmptyString(entry.sourceUrl) ||
      !isNonEmptyString(entry.quantization) ||
      !isPositiveInteger(entry.sizeBytes) ||
      !isCapabilities(entry.capabilities) ||
      !Array.isArray(entry.files) ||
      entry.files.length === 0
    ) {
      throw new Error(`model ${index} is missing required fields`)
    }
    const files = entry.files.map((rawFile, fileIndex): ModelFileEntry => {
      if (typeof rawFile !== 'object' || rawFile === null) {
        throw new Error(`model ${index} file ${fileIndex} is not an object`)
      }
      const file = rawFile as Record<string, unknown>
      if (
        !isNonEmptyString(file.path) ||
        !isNonEmptyString(file.url) ||
        !isNonEmptyString(file.sha256) ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !isPositiveInteger(file.sizeBytes)
      ) {
        throw new Error(`model ${index} file ${fileIndex} is invalid`)
      }
      return {
        path: file.path,
        url: file.url,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes
      }
    })
    return {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      runtime: entry.runtime,
      files,
      sizeBytes: entry.sizeBytes,
      license: entry.license,
      sourceUrl: entry.sourceUrl,
      quantization: entry.quantization,
      capabilities: entry.capabilities
    }
  })

  const runtimes = record.runtimes.map((raw, index): RuntimeCatalogEntry => {
    if (typeof raw !== 'object' || raw === null) throw new Error(`runtime ${index} is not an object`)
    const entry = raw as Record<string, unknown>
    if (
      !isNonEmptyString(entry.id) ||
      !isNonEmptyString(entry.version) ||
      !isNonEmptyString(entry.tag) ||
      !isNonEmptyString(entry.commit) ||
      !isNonEmptyString(entry.sourceUrl) ||
      !isNonEmptyString(entry.license) ||
      !isNonEmptyString(entry.buildDir) ||
      !isNonEmptyString(entry.binary)
    ) {
      throw new Error(`runtime ${index} is missing required fields`)
    }
    return {
      id: entry.id,
      version: entry.version,
      tag: entry.tag,
      commit: entry.commit,
      sourceUrl: entry.sourceUrl,
      license: entry.license,
      buildDir: entry.buildDir,
      binary: entry.binary
    }
  })

  return { schemaVersion: 1, models, runtimes }
}

export function toModelDescriptor(entry: ModelCatalogEntry): AsrModelDescriptor {
  return {
    id: entry.id,
    version: entry.version,
    runtime: entry.runtime,
    files: entry.files.map(({ path, sha256, sizeBytes }) => ({ path, sha256, sizeBytes })),
    sizeBytes: entry.sizeBytes,
    license: entry.license,
    sourceUrl: entry.sourceUrl,
    quantization: entry.quantization,
    capabilities: entry.capabilities
  }
}

export function findModel(catalog: ModelCatalog, id: string): ModelCatalogEntry {
  const model = catalog.models.find((entry) => entry.id === id)
  if (!model) throw new Error(`model not in catalog: ${id}`)
  return model
}

export function findRuntime(catalog: ModelCatalog, id: string): RuntimeCatalogEntry {
  const runtime = catalog.runtimes.find((entry) => entry.id === id)
  if (!runtime) throw new Error(`runtime not in catalog: ${id}`)
  return runtime
}
