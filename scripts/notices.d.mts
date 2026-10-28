export interface SourceManifest {
  name?: string
  version?: string
  license?: unknown
  repository?: unknown
  homepage?: string
}

export interface NoticesEntry {
  kind: 'npm' | 'electron' | 'model' | 'runtime'
  name: string
  version: string
  license: string
  sourceUrl: string
  note: string
}

export interface LicenseGroup {
  license: string
  entries: NoticesEntry[]
}

export function normalizeLicense(manifest: SourceManifest): string
export function resolveSourceUrl(
  manifest: SourceManifest,
  name: string,
  version: string
): string
export function createDependencyEntry(
  name: string,
  version: string,
  manifest: SourceManifest,
  options?: { kind?: NoticesEntry['kind']; note?: string }
): NoticesEntry
export function collectCatalogEntries(catalog: {
  models?: Array<Record<string, unknown>>
  runtimes?: Array<Record<string, unknown>>
}): NoticesEntry[]
export function collectNpmEntries(root: string): NoticesEntry[]
export function collectElectronEntry(root: string): NoticesEntry[]
export function groupByLicense(entries: NoticesEntry[]): LicenseGroup[]
export function renderNotices(input: {
  dependencyEntries: NoticesEntry[]
  catalogEntries: NoticesEntry[]
}): string
