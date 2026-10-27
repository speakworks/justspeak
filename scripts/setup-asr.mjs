#!/usr/bin/env node
/**
 * Prepare the pinned local ASR runtime and model into the gitignored models/.
 *
 *   node scripts/setup-asr.mjs --check
 *   node scripts/setup-asr.mjs
 *   node scripts/setup-asr.mjs --model-file /path/to/Qwen3-ASR-0.6B-Q8_0.gguf
 *
 * No weights or binaries are committed. The model is verified by size and
 * SHA-256 from resources/models.json before it is installed.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, unlink } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(await readFile(path.join(ROOT, 'resources/models.json'), 'utf8'))
const model = catalog.models.find((entry) => entry.id === 'qwen3-asr-0.6b-q8')
const runtime = catalog.runtimes.find((entry) => entry.id === model.runtime)
if (!model || !runtime) throw new Error('catalog is missing the pinned qwen3 model/runtime')

const file = model.files[0]
const modelsDir = path.join(ROOT, 'models')
const runtimeDir = path.join(ROOT, runtime.buildDir)
const cliPath = path.join(runtimeDir, runtime.binary)
const modelPath = path.join(modelsDir, file.path)
const checkOnly = process.argv.includes('--check')
const modelFileArg = process.argv.indexOf('--model-file')
const localModelFile = modelFileArg >= 0 ? process.argv[modelFileArg + 1] : undefined

function run(command, args, cwd) {
  console.log(`$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? result.signal}`)
  }
}

async function sha256File(target) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(target)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

async function verifyModel(target) {
  if (!existsSync(target)) return { ok: false, reason: 'missing' }
  const size = statSync(target).size
  if (size !== file.sizeBytes) {
    return { ok: false, reason: `size ${size} != ${file.sizeBytes}` }
  }
  const digest = await sha256File(target)
  if (digest !== file.sha256) {
    return { ok: false, reason: `sha256 ${digest} != ${file.sha256}` }
  }
  return { ok: true, digest }
}

async function ensureRuntime() {
  if (!existsSync(path.join(runtimeDir, '.git'))) {
    await mkdir(path.dirname(runtimeDir), { recursive: true })
    run('git', ['clone', '--depth', '1', '--branch', runtime.tag, runtime.sourceUrl, runtimeDir])
  } else {
    const result = spawnSync('git', ['-C', runtimeDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
    const commit = result.stdout.trim()
    if (commit !== runtime.commit) {
      throw new Error(
        `runtime checkout is ${commit}, expected ${runtime.commit}. ` +
          `Delete ${runtimeDir} and re-run this script.`
      )
    }
  }

  if (!existsSync(cliPath)) {
    run(
      'cmake',
      ['-B', 'build', '-DCMAKE_BUILD_TYPE=Release', '-DTRANSCRIBE_BUILD_CLI=ON', '-DTRANSCRIBE_BUILD_SHARED=ON'],
      runtimeDir
    )
    run('cmake', ['--build', 'build', '-j', String(Math.max(2, Math.min(8, 8)))], runtimeDir)
  }
}

async function downloadModel() {
  if (localModelFile) {
    console.log(`Verifying local model file: ${localModelFile}`)
    const local = await verifyModel(localModelFile)
    if (!local.ok) throw new Error(`local model file failed verification: ${local.reason}`)
    await mkdir(path.dirname(modelPath), { recursive: true })
    await copyFile(localModelFile, modelPath)
    return
  }

  const endpoint = process.env.HF_ENDPOINT ?? 'https://huggingface.co'
  const url = file.url.replace('https://huggingface.co', endpoint.replace(/\/$/, ''))
  const partial = `${modelPath}.part`
  await mkdir(path.dirname(modelPath), { recursive: true })
  await unlink(partial).catch(() => {})

  console.log(`Downloading ${model.name} (${(file.sizeBytes / 1e6).toFixed(0)} MB)`)
  console.log(`  source: ${model.sourceUrl}`)
  console.log(`  license: ${model.license}`)

  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`)
  const hash = createHash('sha256')
  let bytes = 0
  let lastReported = 0
  const handle = await (await import('node:fs/promises')).open(partial, 'w')
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      const buffer = Buffer.from(chunk)
      bytes += buffer.byteLength
      if (bytes > file.sizeBytes) throw new Error('download exceeded the pinned size')
      hash.update(buffer)
      await handle.write(buffer)
      if (bytes - lastReported > 50 * 1024 * 1024) {
        lastReported = bytes
        console.log(`  ${(bytes / 1e6).toFixed(0)} / ${(file.sizeBytes / 1e6).toFixed(0)} MB`)
      }
    }
  } catch (error) {
    await handle.close().catch(() => {})
    await unlink(partial).catch(() => {})
    throw error
  }
  await handle.close()

  const digest = hash.digest('hex')
  if (bytes !== file.sizeBytes || digest !== file.sha256) {
    await unlink(partial).catch(() => {})
    throw new Error(`verification failed: ${bytes} bytes / ${digest}`)
  }
  await rename(partial, modelPath)
  console.log(`Verified SHA-256 ${digest}`)
}

async function main() {
  const modelState = await verifyModel(modelPath)
  const runtimeOk = existsSync(cliPath)

  if (checkOnly) {
    console.log(`runtime: ${runtimeOk ? 'ready' : 'missing'} ${cliPath}`)
    console.log(
      `model:   ${modelState.ok ? 'ready' : modelState.reason} ${modelPath}`
    )
    console.log(`license: ${model.license} | source: ${model.sourceUrl}`)
    if (!runtimeOk || !modelState.ok) process.exitCode = 1
    return
  }

  if (!runtimeOk) {
    console.log('Preparing pinned transcribe.cpp runtime...')
    await ensureRuntime()
  }
  if (!modelState.ok) {
    if (existsSync(modelPath)) await unlink(modelPath)
    await downloadModel()
  }

  const finalCheck = await verifyModel(modelPath)
  if (!finalCheck.ok) throw new Error(`model is not ready: ${finalCheck.reason}`)
  console.log('ASR ready.')
  console.log(`  runtime: ${cliPath}`)
  console.log(`  model:   ${modelPath}`)
  console.log(`  license: ${model.license}`)
  console.log(`  source:  ${model.sourceUrl}`)
}

await main()
