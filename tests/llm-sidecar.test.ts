import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { LlamaSidecar } from '../src/main/llm/sidecar'

const tempDir = mkdtempSync(path.join(tmpdir(), 'justspeak-llm-sidecar-'))
const fakeServer = path.join(tempDir, 'fake-llama-server')
const pidFile = path.join(tempDir, 'pids')

writeFileSync(
  fakeServer,
  `#!/usr/bin/env node
const http = require('node:http')
const fs = require('node:fs')
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
if (process.env.FAKE_PIDFILE) fs.appendFileSync(process.env.FAKE_PIDFILE, process.pid + '\\n')
const mode = process.env.FAKE_MODE || 'ok'
if (mode === 'ignoreterm') process.on('SIGTERM', () => {})
http.createServer((req, res) => {
  if (req.url === '/health') {
    if (mode === 'nohealth') return
    res.writeHead(200); res.end('ok'); return
  }
  if (req.url === '/v1/chat/completions') {
    if (mode === 'hang') return
    if (mode === 'slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"keep_all"}' } }] }))
      }, 500)
      return
    }
    if (mode === 'http500') { res.writeHead(500); res.end('err'); return }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: mode === 'invalid' ? 'not json' : '{"action":"keep_all"}' } }] }))
    return
  }
  res.writeHead(404); res.end()
}).listen(port, '127.0.0.1')
`,
  'utf8'
)
chmodSync(fakeServer, 0o755)

afterEach(() => {
  delete process.env.FAKE_MODE
  delete process.env.FAKE_PIDFILE
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function sidecar(overrides: { startupTimeoutMs?: number } = {}): LlamaSidecar {
  return new LlamaSidecar({
    binaryPath: fakeServer,
    modelPath: '/tmp/fake.gguf',
    startupTimeoutMs: overrides.startupTimeoutMs ?? 5000
  })
}

describe('LLM sidecar lifecycle', () => {
  it('rejects cleanly when the binary cannot be spawned', async () => {
    const instance = new LlamaSidecar({
      binaryPath: path.join(tempDir, 'missing-llama-server'),
      modelPath: '/tmp/does-not-exist.gguf',
      startupTimeoutMs: 5000
    })
    await expect(instance.start()).rejects.toThrow(/ENOENT/)
    await instance.stop()
    await instance.stop()
  })

  it('rejects when the binary exits before becoming healthy', async () => {
    const binary = path.join(tempDir, 'exit-immediately')
    writeFileSync(binary, '#!/bin/sh\nexit 1\n')
    chmodSync(binary, 0o755)
    const instance = new LlamaSidecar({
      binaryPath: binary,
      modelPath: '/tmp/does-not-exist.gguf',
      startupTimeoutMs: 5000
    })
    await expect(instance.start()).rejects.toThrow(/exited during startup/)
    await instance.stop()
  })

  it('refuses to decide before start', async () => {
    const instance = sidecar()
    await expect(instance.decide('周一发，不对，周二发。')).rejects.toThrow('not started')
    await instance.stop()
  })

  it('parses a healthy response', async () => {
    process.env.FAKE_MODE = 'ok'
    const instance = sidecar()
    await instance.start()
    const result = await instance.decide('周一发，不对，周二发。')
    expect(result).toMatchObject({ action: 'keep_all', timedOut: false })
    await instance.stop()
  })

  it('falls back on HTTP 500 and invalid JSON', async () => {
    process.env.FAKE_MODE = 'http500'
    const http500 = sidecar()
    await http500.start()
    expect(await http500.decide('周一发，不对，周二发。')).toMatchObject({
      action: 'defer_to_human',
      timedOut: false
    })
    await http500.stop()

    process.env.FAKE_MODE = 'invalid'
    const invalid = sidecar()
    await invalid.start()
    expect(await invalid.decide('周一发，不对，周二发。')).toMatchObject({
      action: 'defer_to_human',
      timedOut: false
    })
    await invalid.stop()
  })

  it('returns timedOut on an aborted request', async () => {
    process.env.FAKE_MODE = 'slow'
    const instance = sidecar()
    await instance.start()
    const result = await instance.decide('周一发，不对，周二发。', 50)
    expect(result).toMatchObject({ action: 'defer_to_human', timedOut: true })
    await instance.stop()
  })

  it('cleans up a startup timeout and can restart', async () => {
    process.env.FAKE_PIDFILE = pidFile
    process.env.FAKE_MODE = 'nohealth'
    rmSync(pidFile, { force: true })
    const instance = sidecar({ startupTimeoutMs: 300 })
    await expect(instance.start()).rejects.toThrow(/did not become healthy/)

    const pids = readFileSync(pidFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(Number)
    expect(pids.length).toBeGreaterThan(0)
    await new Promise((resolve) => setTimeout(resolve, 200))
    for (const pid of pids) {
      expect(() => process.kill(pid, 0)).toThrow()
    }

    process.env.FAKE_MODE = 'ok'
    await instance.start()
    expect((await instance.decide('周一发，不对，周二发。')).action).toBe('keep_all')
    await instance.stop()
  })

  it('does not spawn twice for concurrent start calls', async () => {
    process.env.FAKE_PIDFILE = pidFile
    process.env.FAKE_MODE = 'ok'
    rmSync(pidFile, { force: true })
    const instance = sidecar()
    await Promise.all([instance.start(), instance.start()])
    expect(readFileSync(pidFile, 'utf8').trim().split('\n').length).toBe(1)
    await instance.stop()
  })

  it('falls back after the sidecar is killed', async () => {
    process.env.FAKE_MODE = 'ok'
    const instance = sidecar()
    await instance.start()
    process.kill(instance.pid as number, 'SIGKILL')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(await instance.decide('周一发，不对，周二发。')).toMatchObject({
      action: 'defer_to_human',
      timedOut: false
    })
    await instance.stop()
  })

  it('escalates a pending graceful stop when force is requested', async () => {
    process.env.FAKE_MODE = 'ignoreterm'
    const instance = sidecar()
    await instance.start()
    const pid = instance.pid as number

    const graceful = instance.stop()
    const started = Date.now()
    await instance.stop(true)
    await graceful

    expect(Date.now() - started).toBeLessThan(2500)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(() => process.kill(pid, 0)).toThrow()
  })

  it('force-stops the child', async () => {
    process.env.FAKE_MODE = 'ok'
    const instance = sidecar()
    await instance.start()
    const pid = instance.pid as number
    await instance.stop(true)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(() => process.kill(pid, 0)).toThrow()
  })

  it('waits for an in-flight stop before starting again', async () => {
    process.env.FAKE_MODE = 'ok'
    const instance = sidecar()
    await instance.start()
    const stopping = instance.stop()
    const starting = instance.start()
    await stopping
    await starting
    expect((await instance.decide('周一发，不对，周二发。')).action).toBe('keep_all')
    await instance.stop()
  })
})
