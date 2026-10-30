#!/usr/bin/env node
/**
 * Regenerate THIRD_PARTY_NOTICES.md from the real production dependency tree
 * and the pinned ASR catalog in resources/models.json.
 *
 *   pnpm notices
 *
 * The output is deterministic: entries are sorted, no timestamps are written,
 * and running the script twice produces a byte-identical file.
 *
 * Every entry must carry a source URL. npm packages fall back to their npmjs
 * page when the manifest has no repository field; catalog entries fail closed
 * when resources/models.json omits sourceUrl.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG_PATH = path.join(ROOT, 'resources', 'models.json')
const OUTPUT_PATH = path.join(ROOT, 'THIRD_PARTY_NOTICES.md')

const KIND_SECTIONS = [
  {
    kind: 'npm',
    title: 'Application dependencies',
    description:
      'Production npm packages resolved from the committed lockfile and packaged with the app.'
  },
  {
    kind: 'electron',
    title: 'Bundled Electron runtime',
    description:
      'Electron ships the application runtime. Its distribution embeds Chromium and Node.js; preserve the upstream `LICENSES.chromium.html` that ships with the Electron distribution.'
  },
  {
    kind: 'model',
    title: 'ASR model weights',
    description:
      'Model weights are not bundled with the app. They are downloaded on first run after the user consents, so they are listed here as distributed components.'
  },
  {
    kind: 'runtime',
    title: 'ASR runtimes',
    description: 'Pinned local ASR runtime used by the first-run model path.'
  }
]

function readJson(target) {
  return JSON.parse(readFileSync(target, 'utf8'))
}

function normalizeRepository(repository) {
  const raw = typeof repository === 'string' ? repository : repository?.url
  if (typeof raw !== 'string' || raw.trim() === '') return undefined

  let url = raw.trim()
  if (url.startsWith('github:')) url = `https://github.com/${url.slice('github:'.length)}`
  else if (url.startsWith('gitlab:')) url = `https://gitlab.com/${url.slice('gitlab:'.length)}`
  else if (url.startsWith('bitbucket:')) {
    url = `https://bitbucket.org/${url.slice('bitbucket:'.length)}`
  }

  url = url
    .replace(/^git\+/, '')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^git:\/\//, 'https://')
    .replace(/^git\+ssh:\/\//, 'https://')
    .replace(/\.git$/, '')
    .replace(/\/$/, '')

  return /^https?:\/\//i.test(url) ? url : undefined
}

export function normalizeLicense(manifest) {
  const value = manifest?.license
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (value && typeof value === 'object') {
    if (typeof value.type === 'string' && value.type.trim() !== '') return value.type.trim()
    if (Array.isArray(value)) {
      const parts = value
        .map((item) => (typeof item === 'string' ? item : item?.type))
        .filter((item) => typeof item === 'string' && item.trim() !== '')
      if (parts.length > 0) return parts.join(' OR ')
    }
  }
  return 'UNKNOWN'
}

export function resolveSourceUrl(manifest, name, version) {
  const repositoryUrl = normalizeRepository(manifest?.repository)
  if (repositoryUrl) return repositoryUrl
  if (typeof manifest?.homepage === 'string' && /^https?:\/\//i.test(manifest.homepage)) {
    return manifest.homepage.trim()
  }
  return `https://www.npmjs.com/package/${name}/v/${version}`
}

export function createDependencyEntry(name, version, manifest, options = {}) {
  return {
    kind: options.kind ?? 'npm',
    name,
    version,
    license: normalizeLicense(manifest),
    sourceUrl: resolveSourceUrl(manifest, name, version),
    note: options.note ?? ''
  }
}

export function collectCatalogEntries(catalog) {
  const entries = []

  for (const model of catalog?.models ?? []) {
    if (typeof model.sourceUrl !== 'string' || model.sourceUrl.trim() === '') {
      throw new Error(`model ${model.id ?? model.name ?? '<unknown>'} is missing sourceUrl`)
    }
    const quantization = model.quantization ? ` (${model.quantization})` : ''
    entries.push({
      kind: 'model',
      name: model.name ?? model.id,
      version: model.version ?? model.id,
      license: model.license ?? 'UNKNOWN',
      sourceUrl: model.sourceUrl,
      note: `Weights${quantization}; downloaded on first run, not bundled with the app.`
    })
  }

  for (const runtime of catalog?.runtimes ?? []) {
    if (typeof runtime.sourceUrl !== 'string' || runtime.sourceUrl.trim() === '') {
      throw new Error(`runtime ${runtime.id ?? '<unknown>'} is missing sourceUrl`)
    }
    const suffix = runtime.version ? `-${runtime.version}` : ''
    const name =
      runtime.id && suffix && runtime.id.endsWith(suffix)
        ? runtime.id.slice(0, -suffix.length)
        : (runtime.id ?? runtime.sourceUrl)
    const provenance = [
      runtime.tag ? `tag ${runtime.tag}` : '',
      runtime.commit ? `commit ${runtime.commit}` : ''
    ]
      .filter(Boolean)
      .join(', ')
    entries.push({
      kind: 'runtime',
      name,
      version: runtime.version ?? runtime.id,
      license: runtime.license ?? 'UNKNOWN',
      sourceUrl: runtime.sourceUrl,
      note: provenance ? `Pinned runtime (${provenance}).` : 'Pinned runtime.'
    })
  }

  return entries
}

function collectNpmListing(root) {
  const result = spawnSync('pnpm', ['list', '--prod', '--json', '--depth', 'Infinity'], {
    cwd: root,
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    throw new Error(`pnpm list failed: ${result.stderr?.trim() || result.status}`)
  }
  return JSON.parse(result.stdout)
}

function flattenDependencies(nodes, collected, seen) {
  for (const [fallbackName, node] of Object.entries(nodes ?? {})) {
    const name = node.from ?? fallbackName
    const version = node.version ?? '0.0.0'
    const key = `${name}@${version}`
    if (!seen.has(key)) {
      seen.add(key)
      collected.push({ name, version, path: node.path })
    }
    flattenDependencies(node.dependencies, collected, seen)
  }
}

export function collectNpmEntries(root) {
  const listing = collectNpmListing(root)
  const collected = []
  const seen = new Set()
  for (const project of listing) flattenDependencies(project.dependencies, collected, seen)

  const entries = collected.map(({ name, version, path: packagePath }) => {
    const manifestPath = packagePath ? path.join(packagePath, 'package.json') : undefined
    const manifest = manifestPath && existsSync(manifestPath) ? readJson(manifestPath) : {}
    return createDependencyEntry(manifest.name ?? name, version, manifest)
  })

  return entries.sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`)
  )
}

export function collectElectronEntry(root) {
  const manifestPath = path.join(root, 'node_modules', 'electron', 'package.json')
  if (!existsSync(manifestPath)) return []
  const manifest = readJson(manifestPath)
  return [
    createDependencyEntry(manifest.name, manifest.version, manifest, {
      kind: 'electron',
      note:
        'Electron embeds Chromium and Node.js. Preserve the upstream Electron LICENSE and LICENSES.chromium.html from the distribution.'
    })
  ]
}

export function groupByLicense(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const key = entry.license
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }
  return [...groups.entries()]
    .map(([license, groupEntries]) => ({
      license,
      entries: [...groupEntries].sort((left, right) =>
        `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`)
      )
    }))
    .sort((left, right) => left.license.localeCompare(right.license))
}

function escapeCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
}

function renderTable(entries) {
  const lines = [
    '| Name | Version | License | Source | Notes |',
    '| --- | --- | --- | --- | --- |'
  ]
  for (const entry of entries) {
    lines.push(
      `| ${escapeCell(entry.name)} | ${escapeCell(entry.version)} | ${escapeCell(
        entry.license
      )} | ${escapeCell(entry.sourceUrl)} | ${escapeCell(entry.note)} |`
    )
  }
  return lines.join('\n')
}

export function renderNotices({ dependencyEntries, catalogEntries }) {
  const allEntries = [...dependencyEntries, ...catalogEntries]
  const groups = groupByLicense(allEntries)

  const sections = KIND_SECTIONS.map(({ kind, title, description }) => {
    const entries = allEntries
      .filter((entry) => entry.kind === kind)
      .sort((left, right) =>
        `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`)
      )
    if (entries.length === 0) return ''
    return `## ${title}\n\n${description}\n\n${renderTable(entries)}\n`
  }).filter(Boolean)

  const summary = [
    '| License | Components | Count |',
    '| --- | --- | --- |',
    ...groups.map(
      ({ license, entries }) =>
        `| ${escapeCell(license)} | ${escapeCell(
          entries.map((entry) => entry.name).join(', ')
        )} | ${entries.length} |`
    )
  ].join('\n')

  return `# Third-Party Notices

JustSpeak is released under the MIT License (see [LICENSE](LICENSE)). This file lists
the third-party software and model weights distributed with or referenced by JustSpeak,
with the license and upstream source for each entry.

It is generated by \`pnpm notices\` from the production dependency tree and
\`resources/models.json\`. Do not edit it by hand; change the inputs instead.

Total entries: ${allEntries.length}.

## License summary

${summary}

${sections.join('\n')}## License texts

This file records license identifiers and sources; an identifier alone is not a license
grant. The full text each identifier points at ships beside this file in \`licenses/\`
(one file per component, plus the canonical Apache-2.0 text), together with the upstream
\`NOTICE\` files for the two model conversions — which state what the conversion changed,
as Apache-2.0 section 4(d) expects — and Electron's \`LICENSE\` and
\`LICENSES.chromium.html\` copied from the Electron distribution. The packaged app carries
both this file and \`licenses/\` under \`Contents/Resources/\`.
`
}

async function main() {
  const catalog = readJson(CATALOG_PATH)
  const dependencyEntries = [...collectNpmEntries(ROOT), ...collectElectronEntry(ROOT)]
  const catalogEntries = collectCatalogEntries(catalog)
  const markdown = renderNotices({ dependencyEntries, catalogEntries })
  await writeFile(OUTPUT_PATH, markdown, 'utf8')
  console.log(
    `wrote ${path.relative(ROOT, OUTPUT_PATH)}: ${dependencyEntries.length} package entries, ` +
      `${catalogEntries.length} catalog entries`
  )
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  await main()
}
