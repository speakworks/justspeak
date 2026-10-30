import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import catalog from '../resources/models.json'
import packageJson from '../package.json'
import {
  collectCatalogEntries,
  collectElectronEntry,
  collectNpmEntries,
  renderNotices
} from '../scripts/notices.mjs'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

describe('packaging configuration and generated artifacts', () => {
  it('only documents package scripts that exist', () => {
    const config = readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8')
    const referenced = [...config.matchAll(/pnpm\s+([a-z][a-z:]*)/gi)].map((match) => match[1])

    expect(referenced.length).toBeGreaterThan(0)
    for (const script of referenced) {
      expect(
        Object.keys(packageJson.scripts),
        `electron-builder.yml documents "pnpm ${script}", which package.json does not define`
      ).toContain(script)
    }
  })

  it('keeps THIRD_PARTY_NOTICES.md in sync with the production dependency tree', () => {
    const committed = readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    const dependencyEntries = [...collectNpmEntries(ROOT), ...collectElectronEntry(ROOT)]
    const catalogEntries = collectCatalogEntries(catalog)

    expect(renderNotices({ dependencyEntries, catalogEntries })).toBe(committed)
  })

  it('records the notices file as shipped in the licensing doc', () => {
    const licensing = readFileSync(path.join(ROOT, 'docs', 'LICENSING.md'), 'utf8')

    expect(licensing).toContain('- [x] Create `THIRD_PARTY_NOTICES.md` at the repository root')
    expect(licensing).not.toMatch(/`THIRD_PARTY_NOTICES\.md` does \*\*not\*\* exist/)
  })
})

describe('license texts travel with the app', () => {
  const notices = readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  const shipped = readdirSync(path.join(ROOT, 'licenses'))
  const config = readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8')

  /** Every distinct identifier in the notices summary table. */
  const identifiers = [
    ...notices.slice(0, notices.indexOf('## Application dependencies')).matchAll(/^\| ([^|]+?) \| [^|]+ \| \d+ \|$/gm)
  ]
    .map((match) => match[1].trim())
    .filter((identifier) => identifier !== 'License')

  it('finds licence identifiers to check', () => {
    expect(identifiers.length).toBeGreaterThan(0)
  })

  it('carries a text file for every identifier the notices file names', () => {
    for (const identifier of identifiers) {
      const hasText = shipped.some(
        (file) => file.toLowerCase().startsWith(identifier.toLowerCase()) && file.endsWith('.txt')
      )
      expect(hasText, `no text for "${identifier}" in licenses/`).toBe(true)
    }
  })

  it('ships the notices and the license directory in the packaged app', () => {
    expect(config).toContain('from: THIRD_PARTY_NOTICES.md')
    expect(config).toContain('from: licenses')
    expect(config).toContain('node_modules/electron/dist/LICENSE')
    expect(config).toContain('node_modules/electron/dist/LICENSES.chromium.html')
  })
})
