/**
 * Report the signing state and bundled runtime of a built .app.
 *
 *   pnpm verify:mac release/mac-arm64/JustSpeak.app
 *   pnpm verify:mac release/mac-arm64/JustSpeak.app --require-distribution
 *
 * Without `--require-distribution` this is informational: the local unsigned
 * build is expected to report `ad-hoc`/`unsigned`, and the command still exits
 * 0. With it, a build must carry a Developer ID signature, pass Gatekeeper, have
 * a stapled notarisation ticket, and carry a relocatable, signed ASR runtime —
 * the release gate, not the local one.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isRelocatableRpath,
  parseOtoolDependencies,
  parseRpaths,
  planRuntimeLinks
} from '../src/core/asr/runtime-package'
import { parseLlmModelCatalog } from '../src/core/llm/model-catalog'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const requireDistribution = args.includes('--require-distribution')
const appArg = args.find((argument) => !argument.startsWith('--'))
const app = path.resolve(ROOT, appArg ?? 'release/mac-arm64/JustSpeak.app')

interface Result {
  label: string
  ok: boolean
  detail: string
}

interface RuntimeManifest {
  id: string
  commit: string
  files: string[]
}

function capture(command: string, commandArgs: string[]): { status: number; output: string } {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' })
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  }
}

function firstLine(output: string): string {
  return output.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
}

function readManifest(runtimeDir: string): RuntimeManifest {
  const manifest = JSON.parse(
    readFileSync(path.join(runtimeDir, 'manifest.json'), 'utf8')
  ) as Partial<RuntimeManifest>
  if (
    typeof manifest.id !== 'string' ||
    typeof manifest.commit !== 'string' ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0 ||
    !manifest.files.every((file) => typeof file === 'string')
  ) {
    throw new Error('manifest.json is missing id, commit or files')
  }
  return { id: manifest.id, commit: manifest.commit, files: manifest.files }
}

/**
 * A runtime-less app still signs, passes Gatekeeper and staples, so the release
 * gate has to look inside the bundle. This mirrors the staging checks against
 * the shipped copy: manifest, link closure, `@loader_path` rpaths, arm64 slices
 * and signatures.
 */
function checkBundledRuntime(): Result {
  const label = 'bundled runtime'
  const resources = path.join(app, 'Contents/Resources')
  const runtimeDir = path.join(resources, 'runtime')

  if (!existsSync(runtimeDir)) {
    return { label, ok: false, detail: `missing ${runtimeDir}` }
  }

  let manifest: RuntimeManifest
  try {
    manifest = readManifest(runtimeDir)
  } catch (error) {
    return {
      label,
      ok: false,
      detail: `${path.join(runtimeDir, 'manifest.json')}: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const problems: string[] = []
  const files = manifest.files
  for (const file of files) {
    if (!existsSync(path.join(runtimeDir, file))) problems.push(`${file} is missing`)
  }
  if (problems.length > 0) return { label, ok: false, detail: problems.join('; ') }

  const links = files.map((file) => ({
    file,
    dependencies: parseOtoolDependencies(
      capture('otool', ['-L', path.join(runtimeDir, file)]).output
    )
  }))
  problems.push(...planRuntimeLinks(links).problems)

  for (const file of files) {
    const target = path.join(runtimeDir, file)
    const architectures = capture('lipo', ['-archs', target]).output
    if (!architectures.split(/\s+/).includes('arm64')) {
      problems.push(`${file} is not arm64 (${architectures || 'no architecture output'})`)
    }
    for (const rpath of parseRpaths(capture('otool', ['-l', target]).output)) {
      if (!isRelocatableRpath(rpath)) problems.push(`${file} keeps absolute rpath ${rpath}`)
    }
    if (capture('codesign', ['--verify', '--strict', target]).status !== 0) {
      problems.push(`${file} has no valid signature`)
    }
  }

  // The bundle carries its own catalog; a runtime that does not match the
  // pinned commit is a mismatched artifact, not a shipping one.
  const catalogPath = path.join(resources, 'resources/models.json')
  if (!existsSync(catalogPath)) {
    problems.push('resources/models.json is missing from the bundle')
  } else {
    try {
      const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
        runtimes?: Array<{ id?: string; commit?: string }>
      }
      const runtime = catalog.runtimes?.find((entry) => entry.id === manifest.id)
      if (!runtime) problems.push(`catalog has no runtime ${manifest.id}`)
      else if (runtime.commit !== manifest.commit) {
        problems.push(`manifest commit ${manifest.commit} != catalog ${String(runtime.commit)}`)
      }
    } catch (error) {
      problems.push(`catalog is unreadable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return problems.length > 0
    ? { label, ok: false, detail: problems.join('; ') }
    : {
        label,
        ok: true,
        detail: `${files.length} binaries, @loader_path rpaths, arm64, signatures valid`
      }
}

interface LlmRuntimeManifest {
  runtime: string
  version: string
  commit: string
  binary: string
  files: string[]
}

/**
 * The optional local-cleanup backend ships its own signed llama.cpp runtime.
 * A packaging regression there would otherwise only surface when a user opts
 * into the feature, so the release gate checks the same invariants as the ASR
 * runtime: manifest, link closure, `@loader_path`, arm64 and signatures.
 */
function checkBundledLlmRuntime(): Result {
  const label = 'bundled LLM runtime'
  const resources = path.join(app, 'Contents/Resources')
  const runtimeDir = path.join(resources, 'llm')

  if (!existsSync(runtimeDir)) {
    return { label, ok: false, detail: `missing ${runtimeDir}` }
  }

  let manifest: LlmRuntimeManifest
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(runtimeDir, 'manifest.json'), 'utf8')
    ) as Partial<LlmRuntimeManifest>
    if (
      parsed.runtime !== 'llama.cpp' ||
      typeof parsed.version !== 'string' ||
      typeof parsed.commit !== 'string' ||
      typeof parsed.binary !== 'string' ||
      !Array.isArray(parsed.files) ||
      parsed.files.length === 0 ||
      !parsed.files.every((file) => typeof file === 'string')
    ) {
      throw new Error('manifest.json is missing runtime, version, commit, binary or files')
    }
    manifest = parsed as LlmRuntimeManifest
  } catch (error) {
    return {
      label,
      ok: false,
      detail: `${path.join(runtimeDir, 'manifest.json')}: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const problems: string[] = []
  const files = manifest.files
  if (!files.includes(manifest.binary)) problems.push(`manifest does not list ${manifest.binary}`)
  for (const file of files) {
    if (!existsSync(path.join(runtimeDir, file))) problems.push(`${file} is missing`)
  }
  if (problems.length > 0) return { label, ok: false, detail: problems.join('; ') }

  const links = files.map((file) => ({
    file,
    dependencies: parseOtoolDependencies(capture('otool', ['-L', path.join(runtimeDir, file)]).output)
  }))
  problems.push(...planRuntimeLinks(links).problems)

  for (const file of files) {
    const target = path.join(runtimeDir, file)
    const architectures = capture('lipo', ['-archs', target]).output
    if (!architectures.split(/\s+/).includes('arm64')) {
      problems.push(`${file} is not arm64 (${architectures || 'no architecture output'})`)
    }
    for (const rpath of parseRpaths(capture('otool', ['-l', target]).output)) {
      if (!isRelocatableRpath(rpath)) problems.push(`${file} keeps absolute rpath ${rpath}`)
    }
    if (capture('codesign', ['--verify', '--strict', target]).status !== 0) {
      problems.push(`${file} has no valid signature`)
    }
  }

  for (const license of ['llama.cpp-LICENSE', 'jsonhpp-LICENSE', 'cpp-httplib-LICENSE']) {
    if (!existsSync(path.join(runtimeDir, 'licenses', license))) {
      problems.push(`licenses/${license} is missing`)
    }
  }

  const catalogPath = path.join(resources, 'resources/llm-models.json')
  if (!existsSync(catalogPath)) {
    problems.push('resources/llm-models.json is missing from the bundle')
  } else {
    try {
      const catalog = parseLlmModelCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')))
      if (!catalog.models.some((model) => model.id.length > 0)) {
        problems.push('LLM catalog has no usable model')
      }
    } catch (error) {
      problems.push(`LLM catalog is unreadable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return problems.length > 0
    ? { label, ok: false, detail: problems.join('; ') }
    : {
        label,
        ok: true,
        detail: `${files.length} binaries (llama.cpp ${manifest.version}), @loader_path rpaths, arm64, signatures valid`
      }
}

function main(): void {
  if (!existsSync(app)) {
    console.error(`verify-mac-app: app not found at ${app}`)
    console.error('Run pnpm package:mac first.')
    process.exit(1)
  }

  const verify = capture('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  const info = capture('codesign', ['-dv', '--verbose=4', app]).output
  const authority = info
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('Authority=Developer ID Application:'))
  const isAdHoc = /Signature=adhoc/.test(info)
  const team = info
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('TeamIdentifier='))

  const spctl = capture('spctl', ['--assess', '--type', 'execute', '--verbose=4', app])
  const stapler = capture('xcrun', ['stapler', 'validate', app])

  const results: Result[] = [
    {
      label: 'codesign verify',
      ok: verify.status === 0,
      detail:
        verify.status === 0
          ? 'valid signature'
          : firstLine(verify.output) || 'signature invalid or missing'
    },
    {
      label: 'identity',
      ok: Boolean(authority),
      detail: authority ?? (isAdHoc ? 'ad-hoc (local build)' : team ?? 'no Developer ID authority')
    },
    {
      label: 'Gatekeeper',
      ok: spctl.status === 0,
      detail: firstLine(spctl.output) || 'no assessment output'
    },
    {
      label: 'notarisation ticket',
      ok: stapler.status === 0,
      detail: firstLine(stapler.output) || 'not stapled'
    },
    checkBundledRuntime(),
    checkBundledLlmRuntime()
  ]

  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.label}: ${result.detail}`)
  }

  if (!requireDistribution) {
    const signed = authority ? 'Developer ID signed' : isAdHoc ? 'ad-hoc signed' : 'unsigned'
    console.log(`\nLocal build: ${signed}. Release builds must pass --require-distribution.`)
    return
  }

  const failures = results.filter((result) => !result.ok)
  if (failures.length > 0) {
    console.error(`\nNot distributable: ${failures.map((result) => result.label).join(', ')}.`)
    process.exit(1)
  }
  console.log('\nDistributable: Developer ID signed, Gatekeeper accepted, ticket stapled.')
}

main()
