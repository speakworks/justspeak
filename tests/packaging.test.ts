import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import catalog from '../resources/models.json'
import llmCatalog from '../resources/llm-models.json'
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
    const catalogEntries = collectCatalogEntries(catalog, llmCatalog)

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

  /**
   * Component -> the text that satisfies it. Deliberately explicit: matching on
   * a license *family* lets the project's own MIT text stand in for every
   * third-party MIT holder, which is exactly the drift this guard exists to
   * catch.
   */
  const COMPONENT_TEXTS: Record<string, readonly string[]> = {
    react: ['MIT-react.txt'],
    'react-dom': ['MIT-react-dom.txt'],
    scheduler: ['MIT-scheduler.txt'],
    'transcribe.cpp': ['MIT-transcribe.cpp.txt'],
    'llama.cpp': ['MIT-llama.cpp.txt'],
    'Qwen2.5-1.5B-Instruct (Q4_K_M)': ['Apache-2.0.txt'],
    'Qwen3-ASR 0.6B (Q8_0)': ['Apache-2.0.txt', 'NOTICE-Qwen3-ASR-0.6B-gguf.txt'],
    'SenseVoice Small (Q8_0)': [
      'FunASR-Model-License-1.1.txt',
      'NOTICE-SenseVoiceSmall-gguf.txt'
    ]
  }

  /** Electron's texts are copied from its distribution at build time. */
  const ELECTRON_TEXTS = [
    'node_modules/electron/dist/LICENSE',
    'node_modules/electron/dist/LICENSES.chromium.html'
  ]

  /** First column of every row in the notices component tables. */
  const components = [...notices.matchAll(/^\| ([^|]+?) \| [^|]+ \| [^|]+ \| [^|]+ \|/gm)]
    .map((match) => match[1].trim())
    .filter((name) => name !== 'Name' && name !== 'License' && !/^-+$/.test(name))

  it('maps every component the notices file lists to a text', () => {
    expect(components.length).toBeGreaterThan(5)
    for (const component of components) {
      if (component === 'electron') continue
      expect(
        COMPONENT_TEXTS[component],
        `no expected text registered for "${component}" in THIRD_PARTY_NOTICES.md`
      ).toBeDefined()
    }
    for (const registered of Object.keys(COMPONENT_TEXTS)) {
      expect(components, `${registered} is registered but no longer listed`).toContain(registered)
    }
  })

  it('carries the registered text for every component', () => {
    // Binding a component to its own filename is what makes removal fail; the
    // three Meta MIT texts are byte-identical, so a family match would let any
    // one of them stand in for the others.
    for (const [component, files] of Object.entries(COMPONENT_TEXTS)) {
      for (const file of files) {
        expect(shipped, `${component} is missing ${file}`).toContain(file)
      }
    }
  })

  it('has the Electron texts on disk where the builder copies them from', () => {
    for (const source of ELECTRON_TEXTS) {
      expect(existsSync(path.join(ROOT, source)), `${source} is absent`).toBe(true)
    }
  })

  it('ships the project license, which the notices file links to', () => {
    expect(shipped).toContain('MIT-JustSpeak.txt')
    expect(readFileSync(path.join(ROOT, 'licenses', 'MIT-JustSpeak.txt'), 'utf8')).toBe(
      readFileSync(path.join(ROOT, 'LICENSE'), 'utf8')
    )
    // `[LICENSE](LICENSE)` in the notices file resolves next to it in the bundle.
    expect(config).toContain('from: LICENSE')
  })

  it('ships the notices and the license directory in the packaged app', () => {
    expect(config).toContain('from: THIRD_PARTY_NOTICES.md')
    expect(config).toContain('from: licenses')
    for (const source of ELECTRON_TEXTS) expect(config).toContain(source)
  })
})

describe('the packaged app carries its icons', () => {
  const config = readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8')

  it('builds with the project icon instead of Electron’s default', () => {
    // electron-builder only picks up `mac.icon`; without it a packaged Dock,
    // Finder and DMG all show the Electron atom.
    expect(config).toMatch(/^\s*icon: resources\/icon\.icns$/m)
    expect(existsSync(path.join(ROOT, 'resources/icon.icns'))).toBe(true)
  })

  it('ships the menu-bar template images where the tray reads them', () => {
    // `src/main/tray.ts` resolves `process.resourcesPath/resources`, so the two
    // PNGs must be copied there and not only consumed at build time.
    expect(config).toContain('from: resources/trayTemplate.png')
    expect(config).toContain('from: resources/trayTemplate@2x.png')
    for (const file of ['trayTemplate.png', 'trayTemplate@2x.png']) {
      const full = path.join(ROOT, 'resources', file)
      expect(existsSync(full), `${file} is absent`).toBe(true)
      // A zero-byte template renders as an empty menu-bar slot.
      expect(statSync(full).size).toBeGreaterThan(0)
    }
  })
})

describe('the packaged app carries its ASR runtime', () => {
  const config = readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8')

  it('copies the staged runtime to Contents/Resources/runtime', () => {
    expect(config).toContain('from: resources/runtime')
    expect(config).toContain('to: runtime')
  })

  it('keeps the staged binary name aligned with the catalog', () => {
    // Packaged resolution derives the executable from the catalog's
    // `binary` basename; staging hard-codes the same name.
    expect(path.basename(catalog.runtimes[0].binary)).toBe('transcribe-cli')
  })

  it('keeps the signed build’s entitlements file in a tracked directory', () => {
    // `build/` is gitignored, so an entitlements file there would exist only on
    // the machine that created it.
    const entitlements = path.join(ROOT, 'resources/entitlements.mac.plist')
    expect(existsSync(entitlements)).toBe(true)
    const script = readFileSync(path.join(ROOT, 'scripts/package-mac-signed.ts'), 'utf8')
    expect(script).toContain('resources/entitlements.mac.plist')
  })
})
