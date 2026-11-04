/**
 * Stage the llama.cpp server for the LLM sidecar spike.
 *
 *   node --import tsx scripts/package-llm-runtime.ts
 *   node --import tsx scripts/package-llm-runtime.ts --check
 *
 * Mirrors scripts/package-runtime.ts: copy the binary and its `@rpath`
 * dependencies into a flat directory, rewrite absolute rpaths to
 * `@loader_path`, re-sign ad-hoc, and carry the license texts. The spike uses
 * this to prove a downloaded model can run from a relocatable bundle rather
 * than the build tree.
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isRelocatableRpath,
  parseOtoolDependencies,
  parseRpaths,
  planRuntimeLinks,
  type RuntimeLinkInput
} from '../src/core/asr/runtime-package'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_DIR = path.join(ROOT, 'models/runtime/llama.cpp/build/bin')
const STAGE_DIR = path.join(ROOT, 'resources/llm')
const TEMP_DIR = `${STAGE_DIR}.tmp-${process.pid}`
const CLI_NAME = 'llama-server'
const EXPECTED_VERSION = '0.8.0-dev'
const EXPECTED_COMMIT = '8642541'

const LICENSE_FILES: Array<{ from: string; to: string }> = [
  { from: 'LICENSE', to: 'llama.cpp-LICENSE' },
  { from: 'licenses/LICENSE-jsonhpp', to: 'jsonhpp-LICENSE' },
  { from: 'vendor/cpp-httplib/LICENSE', to: 'cpp-httplib-LICENSE' }
]

const check = process.argv.includes('--check')

function fail(message: string): never {
  throw new Error(message)
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
  }
  return result.stdout
}

function dependenciesOf(file: string): string[] {
  return parseOtoolDependencies(run('otool', ['-L', file]))
}

/** Names referenced through `@rpath` by the binary and transitively by dylibs. */
function collectFiles(): string[] {
  const cli = path.join(SOURCE_DIR, CLI_NAME)
  if (!existsSync(cli)) fail(`llama-server is not built at ${cli}; build llama.cpp first`)
  const files = new Set<string>([CLI_NAME])
  const queue = [CLI_NAME]
  while (queue.length > 0) {
    const current = queue.shift() as string
    const source = current === CLI_NAME ? cli : path.join(SOURCE_DIR, current)
    for (const reference of dependenciesOf(source)) {
      if (!reference.startsWith('@rpath/')) continue
      const name = reference.slice('@rpath/'.length)
      if (files.has(name)) continue
      const target = path.join(SOURCE_DIR, name)
      if (!existsSync(target)) fail(`${current} references ${reference}, missing in ${SOURCE_DIR}`)
      files.add(name)
      queue.push(name)
    }
  }
  return [...files]
}

function stage(files: string[]): void {
  mkdirSync(path.join(TEMP_DIR, 'licenses'), { recursive: true })
  for (const file of files) {
    const source = path.join(SOURCE_DIR, file)
    const target = path.join(TEMP_DIR, file)
    copyFileSync(realpathSync(source), target)
    chmodSync(target, 0o755)
  }

  for (const license of LICENSE_FILES) {
    const source = path.join(ROOT, 'models/runtime/llama.cpp', license.from)
    if (!existsSync(source)) fail(`missing license ${source}`)
    copyFileSync(source, path.join(TEMP_DIR, 'licenses', license.to))
    chmodSync(path.join(TEMP_DIR, 'licenses', license.to), 0o644)
  }
}

function stagedFiles(dir: string): string[] {
  const manifestPath = path.join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) fail(`staged LLM runtime is missing manifest.json`)
  let manifest: {
    runtime?: unknown
    version?: unknown
    commit?: unknown
    binary?: unknown
    files?: unknown
  }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    fail(`manifest.json is unreadable: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (manifest.runtime !== 'llama.cpp') fail('manifest.json runtime is not llama.cpp')
  if (manifest.version !== EXPECTED_VERSION) fail(`manifest.json version is not ${EXPECTED_VERSION}`)
  if (manifest.commit !== EXPECTED_COMMIT) fail(`manifest.json commit is not ${EXPECTED_COMMIT}`)
  if (manifest.binary !== CLI_NAME) fail(`manifest.json does not name ${CLI_NAME}`)
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0 ||
    !manifest.files.every((file) => typeof file === 'string') ||
    !manifest.files.includes(CLI_NAME)
  ) {
    fail('manifest.json file list is invalid')
  }
  return manifest.files as string[]
}

function linkInputs(dir: string, files: string[]): RuntimeLinkInput[] {
  return files.map((file) => ({
    file,
    dependencies: dependenciesOf(path.join(dir, file))
  }))
}

function relocate(dir: string, files: string[]): void {
  for (const file of files) {
    const target = path.join(dir, file)
    for (const rpath of parseRpaths(run('otool', ['-l', target]))) {
      run('install_name_tool', ['-delete_rpath', rpath, target])
    }
    run('install_name_tool', ['-add_rpath', '@loader_path', target])
    run('codesign', ['--force', '--sign', '-', '--timestamp=none', target])
  }
}

function validate(dir: string): void {
  if (!existsSync(dir)) fail(`no staged LLM runtime at ${dir}`)
  const files = stagedFiles(dir)
  const plan = planRuntimeLinks(linkInputs(dir, files))
  if (plan.problems.length > 0) fail(`LLM runtime is not relocatable:\n  ${plan.problems.join('\n  ')}`)
  for (const file of files) {
    const target = path.join(dir, file)
    const bad = parseRpaths(run('otool', ['-l', target])).filter(
      (rpath) => !isRelocatableRpath(rpath)
    )
    if (bad.length > 0) fail(`${file} keeps absolute rpath ${bad[0]}`)
    run('codesign', ['--verify', '--strict', target])
  }
  for (const license of LICENSE_FILES) {
    if (!existsSync(path.join(dir, 'licenses', license.to))) fail(`missing license ${license.to}`)
  }
}

function writeManifest(dir: string, files: string[]): void {
  writeFileSync(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify(
      {
        runtime: 'llama.cpp',
        version: EXPECTED_VERSION,
        commit: EXPECTED_COMMIT,
        binary: CLI_NAME,
        files
      },
      null,
      2
    )}\n`
  )
}

function main(): void {
  if (check) {
    validate(STAGE_DIR)
    console.log(`LLM runtime staged and relocatable: ${STAGE_DIR}`)
    return
  }

  const files = collectFiles()
  rmSync(TEMP_DIR, { recursive: true, force: true })
  try {
    stage(files)
    writeManifest(TEMP_DIR, files)
    relocate(TEMP_DIR, files)
    validate(TEMP_DIR)
  } catch (error) {
    rmSync(TEMP_DIR, { recursive: true, force: true })
    throw error
  }
  rmSync(STAGE_DIR, { recursive: true, force: true })
  renameSync(TEMP_DIR, STAGE_DIR)
  console.log(`staged ${files.length} runtime files and ${LICENSE_FILES.length} licenses into ${STAGE_DIR}`)
}

try {
  main()
} catch (error) {
  console.error(`package-llm-runtime: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
