import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DiagnosticsLog } from '../src/main/diagnostics/log'
import { LlmCorrector } from '../src/main/llm/corrector'

const directories: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-endpoint-leak-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function failingCorrector(error: unknown): LlmCorrector {
  return new LlmCorrector({
    runtimePath: '/missing',
    localModelPath: '/missing',
    keyStore: { load: async () => undefined },
    fetch: (async () => {
      throw error
    }) as unknown as typeof fetch
  })
}

describe('endpoint failures and diagnostics logs', () => {
  it('does not write the endpoint URL or host into the log', async () => {
    const dir = makeDir()
    const file = path.join(dir, 'justspeak.log')
    const log = new DiagnosticsLog({ file })
    const restore = log.installConsoleTee()
    const host = 'internal-api.corp.example'
    try {
      const dnsFailure = failingCorrector(
        new TypeError('fetch failed', {
          cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), {
            code: 'ENOTFOUND'
          })
        })
      )
      dnsFailure.configure({
        backend: 'endpoint',
        baseUrl: `https://${host}/v1`,
        model: 'qwen2.5:1.5b'
      })
      await dnsFailure.refine('周一发，不对，周二发。')

      const malformed = failingCorrector(
        new TypeError('Failed to parse URL from http://[/v1/chat/completions')
      )
      malformed.configure({ backend: 'endpoint', baseUrl: 'http://[', model: 'qwen2.5:1.5b' })
      await malformed.refine('周一发，不对，周二发。')
    } finally {
      restore()
    }
    await log.flush()

    const content = readFileSync(file, 'utf8')
    expect(content).toContain('[llm] endpoint decision failed')
    expect(content).toContain('ENOTFOUND')
    expect(content).not.toContain(host)
    expect(content).not.toContain('http://[')
  })
})
