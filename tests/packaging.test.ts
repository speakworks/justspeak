import { readFileSync } from 'node:fs'
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
