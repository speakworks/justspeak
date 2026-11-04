import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { LlmCorrector, type LlmLocalStatus } from '../src/main/llm/corrector'

const keyStore = { load: async () => 'secret-key' }

function responseWith(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] })
  } as Response
}

describe('LLM corrector (endpoint)', () => {
  it('sends the transcript as data and applies one action', async () => {
    const fetchMock = vi.fn(async () => responseWith('{"action":"delete_before_keep_after"}'))
    const corrector = new LlmCorrector({
      runtimePath: '/missing',
      localModelPath: '/missing',
      keyStore,
      fetch: fetchMock as unknown as typeof fetch
    })
    corrector.configure({
      backend: 'endpoint',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:1.5b'
    })

    const result = await corrector.refine('周一发，不对，周二发。')
    expect(result).toEqual({
      text: '周二发。',
      applied: ['llm'],
      corrected: true,
      outcome: 'applied'
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-key')
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(body.messages[1].content).toBe('周一发，不对，周二发。')
  })

  it('keeps the rule text when the endpoint fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })
    const corrector = new LlmCorrector({
      runtimePath: '/missing',
      localModelPath: '/missing',
      keyStore,
      fetch: fetchMock as unknown as typeof fetch
    })
    corrector.configure({
      backend: 'endpoint',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:1.5b'
    })
    expect(await corrector.refine('周一发，不对，周二发。')).toMatchObject({
      text: '周一发，不对，周二发。',
      applied: []
    })
  })

  it('does nothing when the backend is off', async () => {
    const fetchMock = vi.fn()
    const corrector = new LlmCorrector({
      runtimePath: '/missing',
      localModelPath: '/missing',
      keyStore,
      fetch: fetchMock as unknown as typeof fetch
    })
    expect(await corrector.refine('周一发，不对，周二发。')).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not duplicate /v1 when the base URL already ends with it', async () => {
    const fetchMock = vi.fn(async () => responseWith('{"action":"keep_all"}'))
    const corrector = new LlmCorrector({
      runtimePath: '/missing',
      localModelPath: '/missing',
      keyStore,
      fetch: fetchMock as unknown as typeof fetch
    })
    corrector.configure({
      backend: 'endpoint',
      baseUrl: 'http://127.0.0.1:11434/v1/',
      model: 'qwen2.5:1.5b'
    })
    await corrector.refine('周一发，不对，周二发。')
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions')
  })

  it('omits Authorization when no key is stored', async () => {
    const fetchMock = vi.fn(async () => responseWith('{"action":"keep_all"}'))
    const corrector = new LlmCorrector({
      runtimePath: '/missing',
      localModelPath: '/missing',
      keyStore: { load: async () => undefined },
      fetch: fetchMock as unknown as typeof fetch
    })
    corrector.configure({
      backend: 'endpoint',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:1.5b'
    })
    await corrector.refine('周一发，不对，周二发。')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('does not call an endpoint with an empty URL or model', async () => {
    const fetchMock = vi.fn(async () => responseWith('{"action":"keep_all"}'))
    const corrector = new LlmCorrector({
      runtimePath: '/missing',
      localModelPath: '/missing',
      keyStore,
      fetch: fetchMock as unknown as typeof fetch
    })
    corrector.configure({ backend: 'endpoint', baseUrl: '  ', model: '' })
    expect(await corrector.refine('周一发，不对，周二发。')).toMatchObject({
      outcome: 'deferred'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never sends the transcript when the backend changes while the key loads', async () => {
    let resolveKey: ((value: string | undefined) => void) | undefined
    const keyLoad = new Promise<string | undefined>((resolve) => {
      resolveKey = resolve
    })
    const fetchMock = vi.fn()
    const corrector = new LlmCorrector({
      runtimePath: '/missing',
      localModelPath: '/missing',
      keyStore: { load: () => keyLoad },
      fetch: fetchMock as unknown as typeof fetch
    })
    corrector.configure({
      backend: 'endpoint',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:1.5b'
    })

    const refining = corrector.refine('周一发，不对，周二发。')
    corrector.configure({ backend: 'off', baseUrl: '', model: '' })
    resolveKey?.('secret-key')

    expect(await refining).toMatchObject({
      text: '周一发，不对，周二发。',
      outcome: 'deferred'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

const tempDir = mkdtempSync(path.join(tmpdir(), 'justspeak-llm-corrector-'))
const fakeServer = path.join(tempDir, 'fake-llama-server')
const modelFile = path.join(tempDir, 'model.gguf')
const pidFile = path.join(tempDir, 'pids')

writeFileSync(modelFile, 'not-a-real-model')
writeFileSync(
  fakeServer,
  `#!/usr/bin/env node
const http = require('node:http')
const fs = require('node:fs')
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
const keyIndex = args.indexOf('--api-key-file')
const apiKey = keyIndex >= 0 ? fs.readFileSync(args[keyIndex + 1], 'utf8').trim() : undefined
if (process.env.FAKE_PIDFILE) fs.appendFileSync(process.env.FAKE_PIDFILE, process.pid + '\\n')
const mode = process.env.FAKE_MODE || 'ok'
if (mode === 'ignoreterm') process.on('SIGTERM', () => {})
http.createServer((req, res) => {
  if (req.url === '/health') {
    if (mode === 'nohealth') return
    res.writeHead(200); res.end('ok'); return
  }
  if (req.url === '/v1/chat/completions') {
    if (apiKey && req.headers.authorization !== 'Bearer ' + apiKey) {
      res.writeHead(401); res.end('unauthorized'); return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"delete_before_keep_after"}' } }] }))
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

function localCorrector(
  onLocalStatusChange?: (status: LlmLocalStatus) => void
): LlmCorrector {
  return new LlmCorrector({
    runtimePath: fakeServer,
    localModelPath: modelFile,
    keyStore: { load: async () => undefined },
    ...(onLocalStatusChange === undefined ? {} : { onLocalStatusChange })
  })
}

function pids(): number[] {
  try {
    return readFileSync(pidFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(Number)
  } catch {
    return []
  }
}

describe('LLM corrector (local lifecycle)', () => {
  it('reports not-ready instead of silently scoring when the runtime is missing', async () => {
    const corrector = new LlmCorrector({
      runtimePath: path.join(tempDir, 'missing-llama-server'),
      localModelPath: modelFile,
      keyStore
    })
    corrector.configure({ backend: 'local', baseUrl: '', model: '' })
    expect(await corrector.warmup()).toBe(false)
    expect(corrector.localStatus).toMatchObject({ state: 'failed' })
    expect(corrector.localStatus.error).toContain('运行时')
    await corrector.dispose(true)
  })

  it('warms the sidecar and pushes each state transition', async () => {
    process.env.FAKE_MODE = 'ok'
    const states: string[] = []
    const corrector = localCorrector((status) => states.push(status.state))
    corrector.configure({ backend: 'local', baseUrl: '', model: '' })
    expect(await corrector.warmup()).toBe(true)
    expect(corrector.localStatus.state).toBe('ready')
    expect(states).toEqual(['starting', 'ready'])
    expect(await corrector.refine('周一发，不对，周二发。')).toMatchObject({
      text: '周二发。',
      outcome: 'applied'
    })
    await corrector.dispose(true)
  })

  it('stops a sidecar whose start is still in flight', async () => {
    process.env.FAKE_MODE = 'nohealth'
    process.env.FAKE_PIDFILE = pidFile
    rmSync(pidFile, { force: true })
    const corrector = localCorrector()
    corrector.configure({ backend: 'local', baseUrl: '', model: '' })

    const warming = corrector.warmup()
    await vi.waitFor(() => expect(pids().length).toBeGreaterThan(0), { timeout: 5000 })
    await corrector.dispose(true)

    expect(await warming).toBe(false)
    await vi.waitFor(
      () => {
        for (const pid of pids()) expect(() => process.kill(pid, 0)).toThrow()
      },
      { timeout: 5000 }
    )
  })

  it('spawns only one sidecar when backend toggles queue behind a pending stop', async () => {
    process.env.FAKE_MODE = 'ignoreterm'
    process.env.FAKE_PIDFILE = pidFile
    rmSync(pidFile, { force: true })
    const corrector = localCorrector()
    corrector.configure({ backend: 'local', baseUrl: '', model: '' })
    expect(await corrector.warmup()).toBe(true)
    expect(pids().length).toBe(1)

    // The running child ignores SIGTERM, so this stop stays pending for 3 s.
    corrector.configure({ backend: 'off', baseUrl: '', model: '' })
    corrector.configure({ backend: 'local', baseUrl: '', model: '' })
    corrector.configure({ backend: 'off', baseUrl: '', model: '' })
    corrector.configure({ backend: 'local', baseUrl: '', model: '' })

    await vi.waitFor(() => expect(corrector.localStatus.state).toBe('ready'), {
      timeout: 15000
    })
    // The queued start that lost the race must not have spawned, and must not
    // have installed a child that dispose() cannot reach.
    expect(pids().length).toBe(2)
    const alive = pids().filter((pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    })
    expect(alive.length).toBe(1)

    await corrector.dispose(true)
    await vi.waitFor(
      () => {
        for (const pid of pids()) expect(() => process.kill(pid, 0)).toThrow()
      },
      { timeout: 5000 }
    )
  })

  it('force-stops a sidecar whose graceful stop is still pending', async () => {
    process.env.FAKE_MODE = 'ignoreterm'
    process.env.FAKE_PIDFILE = pidFile
    rmSync(pidFile, { force: true })
    const corrector = localCorrector()
    corrector.configure({ backend: 'local', baseUrl: '', model: '' })
    expect(await corrector.warmup()).toBe(true)

    // Quit arrives while the 3 s graceful stop is waiting on an ignoring child.
    corrector.configure({ backend: 'off', baseUrl: '', model: '' })
    const started = Date.now()
    await corrector.dispose(true)
    expect(Date.now() - started).toBeLessThan(2500)
    await vi.waitFor(
      () => {
        for (const pid of pids()) expect(() => process.kill(pid, 0)).toThrow()
      },
      { timeout: 5000 }
    )
  })

  it('drops a crashed sidecar and warms a fresh one on the next utterance', async () => {
    process.env.FAKE_MODE = 'ok'
    process.env.FAKE_PIDFILE = pidFile
    rmSync(pidFile, { force: true })
    const states: string[] = []
    const corrector = localCorrector((status) => states.push(status.state))
    corrector.configure({ backend: 'local', baseUrl: '', model: '' })
    expect(await corrector.warmup()).toBe(true)
    const firstPid = pids()[0] as number
    process.kill(firstPid, 'SIGKILL')

    await vi.waitFor(() => expect(corrector.localStatus.state).toBe('failed'), { timeout: 5000 })
    expect(states).toContain('failed')
    // This utterance must use the rule text while a replacement warms.
    expect(await corrector.refine('周一发，不对，周二发。')).toMatchObject({
      text: '周一发，不对，周二发。',
      outcome: 'deferred'
    })
    await vi.waitFor(() => expect(corrector.localStatus.state).toBe('ready'), { timeout: 5000 })
    expect(pids().length).toBe(2)
    expect(await corrector.refine('周一发，不对，周二发。')).toMatchObject({
      text: '周二发。',
      outcome: 'applied'
    })
    await corrector.dispose(true)
  })
})
