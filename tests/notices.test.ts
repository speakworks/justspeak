import { describe, expect, it } from 'vitest'
import catalog from '../resources/models.json'
import {
  collectCatalogEntries,
  createDependencyEntry,
  groupByLicense,
  normalizeLicense,
  renderNotices,
  resolveSourceUrl
} from '../scripts/notices.mjs'

const FIXTURE_DEPENDENCIES = [
  {
    name: '@acme/toolkit',
    version: '2.1.0',
    manifest: {
      name: '@acme/toolkit',
      license: 'MIT',
      repository: { type: 'git', url: 'git+https://github.com/acme/toolkit.git' }
    }
  },
  {
    name: 'apache-runtime',
    version: '5.0.0',
    manifest: {
      name: 'apache-runtime',
      license: { type: 'Apache-2.0' },
      repository: { url: 'git@github.com:acme/apache-runtime.git' }
    }
  },
  {
    name: 'no-repository',
    version: '0.3.2',
    manifest: { name: 'no-repository', license: 'ISC' }
  }
]

function fixtureEntries() {
  return FIXTURE_DEPENDENCIES.map(({ name, version, manifest }) =>
    createDependencyEntry(name, version, manifest)
  )
}

describe('third-party notices generator', () => {
  it.each([
    [
      'string license',
      { license: 'MIT' },
      'MIT'
    ],
    [
      'object license',
      { license: { type: 'Apache-2.0' } },
      'Apache-2.0'
    ],
    [
      'license array',
      { license: [{ type: 'MIT' }, { type: 'Apache-2.0' }] },
      'MIT OR Apache-2.0'
    ],
    ['missing license', {}, 'UNKNOWN']
  ])('normalizes %s', (_label, manifest, expected) => {
    expect(normalizeLicense(manifest)).toBe(expected)
  })

  it.each([
    [
      'git+https repository',
      { repository: { url: 'git+https://github.com/acme/toolkit.git' } },
      'https://github.com/acme/toolkit'
    ],
    [
      'ssh repository',
      { repository: { url: 'git@github.com:acme/apache-runtime.git' } },
      'https://github.com/acme/apache-runtime'
    ],
    [
      'github shorthand',
      { repository: 'github:acme/shorthand' },
      'https://github.com/acme/shorthand'
    ],
    [
      'homepage fallback',
      { homepage: 'https://example.test/home' },
      'https://example.test/home'
    ],
    [
      'npmjs fallback',
      {},
      'https://www.npmjs.com/package/no-repository/v/0.3.2'
    ]
  ])('resolves a source URL from %s', (_label, manifest, expected) => {
    expect(resolveSourceUrl(manifest, 'no-repository', '0.3.2')).toBe(expected)
  })

  it('always emits a source URL for fixture dependencies', () => {
    const entries = fixtureEntries()
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.sourceUrl, `${entry.name}@${entry.version}`).toMatch(/^https?:\/\//)
    }
  })

  it('groups fixture dependencies by license in a stable order', () => {
    expect(groupByLicense(fixtureEntries()).map(({ license }) => license)).toEqual([
      'Apache-2.0',
      'ISC',
      'MIT'
    ])
    expect(
      groupByLicense(fixtureEntries()).map(({ license, entries }) => ({
        license,
        names: entries.map((entry) => entry.name)
      }))
    ).toEqual([
      { license: 'Apache-2.0', names: ['apache-runtime'] },
      { license: 'ISC', names: ['no-repository'] },
      { license: 'MIT', names: ['@acme/toolkit'] }
    ])
  })

  it('includes the pinned model and runtime from resources/models.json', () => {
    const entries = collectCatalogEntries(catalog)
    const model = entries.find((entry) => entry.kind === 'model')
    const runtime = entries.find((entry) => entry.kind === 'runtime')

    expect(model).toMatchObject({
      name: 'Qwen3-ASR 0.6B (Q8_0)',
      license: 'Apache-2.0',
      sourceUrl: 'https://huggingface.co/handy-computer/Qwen3-ASR-0.6B-gguf'
    })
    expect(runtime).toMatchObject({
      name: 'transcribe.cpp',
      version: '0.4.1',
      license: 'MIT',
      sourceUrl: 'https://github.com/handy-computer/transcribe.cpp'
    })
    for (const entry of entries) {
      expect(entry.sourceUrl).toMatch(/^https?:\/\//)
    }
  })

  it('fails closed when a catalog entry has no source URL', () => {
    expect(() =>
      collectCatalogEntries({
        models: [{ id: 'unlicensed', version: '1', license: 'MIT' }],
        runtimes: []
      })
    ).toThrow(/missing sourceUrl/)
  })

  it('renders deterministic markdown with a license summary', () => {
    const input = {
      dependencyEntries: fixtureEntries(),
      catalogEntries: collectCatalogEntries(catalog)
    }
    const first = renderNotices(input)
    const second = renderNotices(input)

    expect(first).toBe(second)
    expect(first).toContain('## License summary')
    expect(first).toContain('| Apache-2.0 | apache-runtime, Qwen3-ASR 0.6B (Q8_0) | 2 |')
    expect(first).toContain('## Application dependencies')
    expect(first).toContain('## ASR model weights')
    expect(first).toContain('## ASR runtimes')
    expect(first).not.toMatch(/generated at|20\d\d-\d\d-\d\d/)
  })
})
