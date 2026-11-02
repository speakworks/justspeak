/**
 * Stage the pinned transcribe.cpp runtime for the app bundle.
 *
 *   node --import tsx scripts/package-runtime.ts            # build resources/runtime
 *   node --import tsx scripts/package-runtime.ts --check    # validate without rebuilding
 *   node --import tsx scripts/package-runtime.ts --run      # also transcribe the fixture
 *
 * CMake bakes the build machine's absolute paths into every binary's LC_RPATH,
 * so a plain copy of `models/runtime/transcribe.cpp/build` only runs on the
 * machine that built it. This script flattens the CLI and its dylibs into
 * `resources/runtime/`, rewrites each rpath to `@loader_path`, re-signs ad-hoc
 * (arm64 refuses to start a binary whose signature `install_name_tool`
 * invalidated), and carries the runtime license texts.
 *
 * Sources are checked and the new tree is built in a temporary directory before
 * the previous `resources/runtime` is replaced, so a failed run never leaves a
 * partial runtime for electron-builder to pack. `resources/runtime/` is
 * gitignored; it exists only between `pnpm setup:asr` and `pnpm package:mac`.
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
  findRuntime,
  parseModelCatalog,
  type RuntimeCatalogEntry
} from '../src/core/asr/model-catalog'
import {
  isRelocatableRpath,
  parseOtoolDependencies,
  parseRpaths,
  planRuntimeLinks,
  type RuntimeLinkInput
} from '../src/core/asr/runtime-package'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STAGE_DIR = path.join(ROOT, 'resources/runtime')
const TEMP_DIR = `${STAGE_DIR}.tmp-${process.pid}`
const RUNTIME_ID = 'transcribe.cpp-0.4.1'
const CLI_NAME = 'transcribe-cli'

/** Dylibs referenced through `@rpath` by the CLI or another dylib. */
const DYLIB_SOURCES = [
  'build/src/libtranscribe.0.4.dylib',
  'build/ggml/src/libggml.0.dylib',
  'build/ggml/src/libggml-cpu.0.dylib',
  'build/ggml/src/ggml-metal/libggml-metal.0.dylib',
  'build/ggml/src/libggml-base.0.dylib'
]

/** Runtime license texts that must travel with the shipped binaries. */
const LICENSE_SOURCES: Array<{ from: string; to: string }> = [
  { from: 'LICENSE', to: 'transcribe.cpp-LICENSE' },
  { from: 'ggml/LICENSE', to: 'ggml-LICENSE' },
  { from: 'src/third_party/miniz/LICENSE', to: 'miniz-LICENSE' },
  { from: 'src/third_party/silero_vad/LICENSE', to: 'silero-vad-LICENSE' }
]

const check = process.argv.includes('--check')
const runFixture = process.argv.includes('--run')

function fail(message: string): never {
  throw new Error(message)
}

function run(command: string, args: string[], options: { cwd?: string } = {}): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(' ')} exited with ${result.status ?? result.signal}\n` +
        `${(result.stderr || result.stdout || '').trim()}`
    )
  }
  return result.stdout
}

function loadRuntime(): RuntimeCatalogEntry {
  const catalogPath = path.join(ROOT, 'resources/models.json')
  const catalog = parseModelCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')))
  return findRuntime(catalog, RUNTIME_ID)
}

function buildRoot(runtime: RuntimeCatalogEntry): string {
  return path.join(ROOT, runtime.buildDir)
}

function expectedFiles(): string[] {
  return [CLI_NAME, ...DYLIB_SOURCES.map((source) => path.basename(source))]
}

interface Sources {
  cli: string
  dylibs: Array<{ from: string; name: string }>
  licenses: Array<{ from: string; name: string }>
}

/** Check every input before touching the previous staged tree. */
function preflight(runtime: RuntimeCatalogEntry): Sources {
  const root = buildRoot(runtime)
  const cli = path.join(root, runtime.binary)
  if (!existsSync(cli)) {
    fail(`runtime is not built at ${cli}; run pnpm setup:asr first`)
  }

  const dylibs = DYLIB_SOURCES.map((source) => {
    const absolute = path.join(root, source)
    if (!existsSync(absolute)) fail(`missing runtime dylib ${absolute}`)
    return { from: realpathSync(absolute), name: path.basename(source) }
  })

  const licenses = LICENSE_SOURCES.map((license) => {
    const absolute = path.join(root, license.from)
    if (!existsSync(absolute)) fail(`missing runtime license text ${absolute}`)
    return { from: absolute, name: license.to }
  })

  return { cli: realpathSync(cli), dylibs, licenses }
}

function stage(sources: Sources, dir: string): void {
  mkdirSync(path.join(dir, 'licenses'), { recursive: true })
  copyBinary(sources.cli, path.join(dir, CLI_NAME))
  for (const dylib of sources.dylibs) copyBinary(dylib.from, path.join(dir, dylib.name))
  for (const license of sources.licenses) {
    copyText(license.from, path.join(dir, 'licenses', license.name))
  }
}

function copyBinary(from: string, to: string): void {
  copyFileSync(from, to)
  chmodSync(to, 0o755)
}

function copyText(from: string, to: string): void {
  copyFileSync(from, to)
  chmodSync(to, 0o644)
}

function dependenciesOf(file: string): string[] {
  return parseOtoolDependencies(run('otool', ['-L', file]))
}

function validateLinks(dir: string): RuntimeLinkInput[] {
  const inputs: RuntimeLinkInput[] = expectedFiles().map((file) => ({
    file,
    dependencies: dependenciesOf(path.join(dir, file))
  }))
  const plan = planRuntimeLinks(inputs)
  if (plan.problems.length > 0) {
    fail(`staged runtime is not relocatable:\n  ${plan.problems.join('\n  ')}`)
  }
  return inputs
}

/** Replace absolute LC_RPATH values with a loader-relative one, then re-sign. */
function relocate(dir: string): void {
  for (const file of expectedFiles()) {
    const target = path.join(dir, file)
    for (const rpath of parseRpaths(run('otool', ['-l', target]))) {
      run('install_name_tool', ['-delete_rpath', rpath, target])
    }
    run('install_name_tool', ['-add_rpath', '@loader_path', target])
    run('codesign', ['--force', '--sign', '-', '--timestamp=none', target])
  }
}

function validateManifest(runtime: RuntimeCatalogEntry, dir: string): void {
  const manifestPath = path.join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) fail(`staged runtime is missing manifest.json`)
  let manifest: { id?: string; commit?: string; files?: unknown }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    fail(`manifest.json is unreadable: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (manifest.id !== runtime.id || manifest.commit !== runtime.commit) {
    fail(`manifest.json does not describe ${runtime.id}@${runtime.commit}`)
  }
  const files = Array.isArray(manifest.files) ? manifest.files : []
  const expected = expectedFiles()
  if (files.length !== expected.length || expected.some((file) => !files.includes(file))) {
    fail('manifest.json file list does not match the staged binaries')
  }
}

function validate(runtime: RuntimeCatalogEntry, dir: string): void {
  if (!existsSync(dir)) {
    fail(`no staged runtime at ${dir}; run pnpm package:runtime first`)
  }
  validateManifest(runtime, dir)
  for (const file of expectedFiles()) {
    const target = path.join(dir, file)
    if (!existsSync(target)) fail(`staged runtime is missing ${file}`)
  }
  validateLinks(dir)

  for (const file of expectedFiles()) {
    const target = path.join(dir, file)
    const architectures = run('lipo', ['-archs', target])
    if (!architectures.split(/\s+/).includes('arm64')) {
      fail(`${file} is not an arm64 binary (architectures: ${architectures.trim()})`)
    }
    const rpaths = parseRpaths(run('otool', ['-l', target]))
    const bad = rpaths.filter((rpath) => !isRelocatableRpath(rpath))
    if (bad.length > 0) fail(`${file} still carries non-relocatable rpath ${bad[0]}`)
    run('codesign', ['--verify', '--strict', target])
  }

  for (const license of LICENSE_SOURCES) {
    if (!existsSync(path.join(dir, 'licenses', license.to))) {
      fail(`staged runtime is missing license ${license.to}`)
    }
  }
}

function writeManifest(runtime: RuntimeCatalogEntry, dir: string): void {
  const manifest = {
    id: runtime.id,
    version: runtime.version,
    tag: runtime.tag,
    commit: runtime.commit,
    sourceUrl: runtime.sourceUrl,
    license: runtime.license,
    files: expectedFiles()
  }
  writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

function transcribeFixture(dir: string): void {
  const model = path.join(ROOT, 'models/sensevoice-small/SenseVoiceSmall-Q8_0.gguf')
  const fixture = path.join(ROOT, 'bench/fixtures/zh-4s.wav')
  if (!existsSync(model)) {
    console.log(`skip --run: model not found at ${model}`)
    return
  }
  const text = run(path.join(dir, CLI_NAME), ['-q', '-m', model, fixture]).trim()
  if (text.length === 0) fail('staged runtime produced no transcript')
  console.log(`staged runtime transcript: ${text}`)
}

function main(): void {
  const runtime = loadRuntime()

  if (check) {
    validate(runtime, STAGE_DIR)
    console.log(`runtime staged and relocatable: ${STAGE_DIR}`)
  } else {
    const sources = preflight(runtime)
    rmSync(TEMP_DIR, { recursive: true, force: true })
    try {
      stage(sources, TEMP_DIR)
      validateLinks(TEMP_DIR)
      relocate(TEMP_DIR)
      writeManifest(runtime, TEMP_DIR)
      validate(runtime, TEMP_DIR)
    } catch (error) {
      rmSync(TEMP_DIR, { recursive: true, force: true })
      throw error
    }
    rmSync(STAGE_DIR, { recursive: true, force: true })
    renameSync(TEMP_DIR, STAGE_DIR)
    console.log(`staged ${expectedFiles().length} binaries into ${STAGE_DIR}`)
  }

  if (runFixture) transcribeFixture(STAGE_DIR)
}

try {
  main()
} catch (error) {
  console.error(`package-runtime: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
