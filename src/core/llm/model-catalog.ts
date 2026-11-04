/**
 * Validated catalog for the optional local correction model.
 *
 * It is separate from `resources/models.json` because ASR models carry
 * capabilities and a runtime id that an LLM entry does not. The download and
 * SHA-256 rules are the same: an unverified model is never used.
 */

export interface LlmModelFile {
  path: string
  url: string
  sha256: string
  sizeBytes: number
}

export interface LlmModelEntry {
  id: string
  name: string
  version: string
  file: LlmModelFile
  license: string
  sourceUrl: string
  quantization: string
}

export interface LlmModelCatalog {
  schemaVersion: 1
  models: LlmModelEntry[]
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function parseLlmModelCatalog(value: unknown): LlmModelCatalog {
  if (typeof value !== 'object' || value === null) throw new Error('LLM catalog must be an object')
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) throw new Error('unsupported LLM catalog schema')
  if (!Array.isArray(record.models) || record.models.length === 0) {
    throw new Error('LLM catalog has no models')
  }

  const models = record.models.map((raw, index): LlmModelEntry => {
    if (typeof raw !== 'object' || raw === null) throw new Error(`LLM model ${index} is not an object`)
    const entry = raw as Record<string, unknown>
    const file = entry.file
    if (typeof file !== 'object' || file === null) throw new Error(`LLM model ${index} has no file`)
    const fileRecord = file as Record<string, unknown>
    if (
      !nonEmpty(entry.id) ||
      !nonEmpty(entry.name) ||
      !nonEmpty(entry.version) ||
      !nonEmpty(entry.license) ||
      !nonEmpty(entry.sourceUrl) ||
      !nonEmpty(entry.quantization) ||
      !nonEmpty(fileRecord.path) ||
      !nonEmpty(fileRecord.url) ||
      !nonEmpty(fileRecord.sha256) ||
      !/^[a-f0-9]{64}$/.test(fileRecord.sha256) ||
      typeof fileRecord.sizeBytes !== 'number' ||
      !Number.isInteger(fileRecord.sizeBytes) ||
      fileRecord.sizeBytes <= 0
    ) {
      throw new Error(`LLM model ${index} is invalid`)
    }
    return {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      file: {
        path: fileRecord.path,
        url: fileRecord.url,
        sha256: fileRecord.sha256,
        sizeBytes: fileRecord.sizeBytes
      },
      license: entry.license,
      sourceUrl: entry.sourceUrl,
      quantization: entry.quantization
    }
  })

  return { schemaVersion: 1, models }
}

export function findLlmModel(catalog: LlmModelCatalog, id: string): LlmModelEntry {
  const model = catalog.models.find((entry) => entry.id === id)
  if (!model) throw new Error(`LLM model not in catalog: ${id}`)
  return model
}
