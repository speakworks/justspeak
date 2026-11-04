import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DiagnosticsSummary } from '../src/core/diagnostics/summary'
import {
  diagnosticsFileName,
  writeDiagnosticsBundle,
  zipDirectory
} from '../src/main/diagnostics/export'
import { resolveDiagnosticsTarget } from '../src/main/diagnostics/target'

const directories: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-diagnostics-export-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const SUMMARY: DiagnosticsSummary = {
  generatedAt: '2026-11-05T00:00:00.000Z',
  app: {
    name: 'JustSpeak',
    version: '0.1.0',
    electron: '45',
    chrome: '1',
    node: '24',
    platform: 'darwin',
    arch: 'arm64',
    locale: 'zh-CN'
  },
  permissions: { accessibility: true, microphone: 'granted' },
  history: { entries: 7 },
  preferences: {
    theme: 'system',
    hotkeyConfigured: true,
    provider: { id: 'qwen3', label: 'Qwen3', selectable: true, reason: 'ready' },
    vocabulary: { state: 'loaded', replaceCount: 1, protectCount: 0 },
    llm: {
      backend: 'off',
      endpoint: { configured: false, modelConfigured: false, hasKey: false },
      local: {
        runtimeReady: false,
        modelReady: false,
        state: 'idle',
        modelName: ''
      }
    }
  }
}

function unzipList(target: string): string {
  const result = spawnSync('/usr/bin/unzip', ['-l', target], { encoding: 'utf8' })
  expect(result.status).toBe(0)
  return result.stdout
}

describe('diagnostics bundle', () => {
  it('writes summary, logs, crash dumps, and the README at the zip root', async () => {
    const dir = makeDir()
    const logsDir = path.join(dir, 'logs-source')
    const dumpsDir = path.join(dir, 'dumps-source')
    mkdirSync(logsDir)
    mkdirSync(dumpsDir)
    const log = path.join(logsDir, 'justspeak.log')
    const dump = path.join(dumpsDir, 'crash.ips')
    writeFileSync(log, 'log line\n')
    writeFileSync(dump, 'dump\n')
    const target = path.join(dir, 'diagnostics.zip')

    await writeDiagnosticsBundle(
      {
        summary: SUMMARY,
        logs: [{ name: 'justspeak.log', path: log }],
        crashDumps: [{ name: 'crash.ips', path: dump }]
      },
      target,
      { stagingRoot: dir }
    )

    const list = unzipList(target)
    expect(list).toContain('summary.json')
    expect(list).toContain('README.txt')
    expect(list).toContain('logs/justspeak.log')
    expect(list).toContain('crash-dumps/crash.ips')
    expect(readdirSync(dir).filter((name) => name.startsWith('justspeak-diagnostics-'))).toEqual([])

    const summary = spawnSync('/usr/bin/unzip', ['-p', target, 'summary.json'], {
      encoding: 'utf8'
    })
    expect(JSON.parse(summary.stdout)).toMatchObject({
      history: { entries: 7 },
      permissions: { accessibility: true }
    })
  })

  it('renames duplicate basenames instead of overwriting them', async () => {
    const dir = makeDir()
    const first = path.join(dir, 'first')
    const second = path.join(dir, 'second')
    mkdirSync(first)
    mkdirSync(second)
    writeFileSync(path.join(first, 'same.log'), 'one\n')
    writeFileSync(path.join(second, 'same.log'), 'two\n')
    const target = path.join(dir, 'diagnostics.zip')

    await writeDiagnosticsBundle(
      {
        summary: SUMMARY,
        logs: [
          { name: 'same.log', path: path.join(first, 'same.log') },
          { name: 'same.log', path: path.join(second, 'same.log') }
        ],
        crashDumps: []
      },
      target,
      { stagingRoot: dir }
    )

    const list = unzipList(target)
    expect(list).toContain('logs/same.log')
    expect(list).toContain('logs/1-same.log')
  })

  it('skips symlinked entries instead of copying their targets', async () => {
    const dir = makeDir()
    const secret = path.join(dir, 'secret.txt')
    writeFileSync(secret, 'TOP-SECRET')
    const link = path.join(dir, 'link.log')
    symlinkSync(secret, link)
    const target = path.join(dir, 'diagnostics.zip')

    await writeDiagnosticsBundle(
      { summary: SUMMARY, logs: [{ name: 'link.log', path: link }], crashDumps: [] },
      target,
      { stagingRoot: dir }
    )

    const list = unzipList(target)
    expect(list).not.toContain('link.log')
    expect(list).not.toContain('secret.txt')
  })

  it('preserves an existing target when zipping fails', async () => {
    const dir = makeDir()
    const staging = path.join(dir, 'staging')
    mkdirSync(staging)
    const log = path.join(dir, 'justspeak.log')
    writeFileSync(log, 'line\n')
    const target = path.join(dir, 'diagnostics.zip')
    writeFileSync(target, 'old zip')

    await expect(
      writeDiagnosticsBundle(
        { summary: SUMMARY, logs: [{ name: 'justspeak.log', path: log }], crashDumps: [] },
        target,
        {
          stagingRoot: staging,
          zip: async () => {
            throw new Error('zip failed')
          }
        }
      )
    ).rejects.toThrow('zip failed')
    expect(readFileSync(target, 'utf8')).toBe('old zip')
  })

  it('replaces an existing target after a successful zip', async () => {
    const dir = makeDir()
    const log = path.join(dir, 'justspeak.log')
    writeFileSync(log, 'line\n')
    const target = path.join(dir, 'diagnostics.zip')
    writeFileSync(target, 'old zip')

    await writeDiagnosticsBundle(
      { summary: SUMMARY, logs: [{ name: 'justspeak.log', path: log }], crashDumps: [] },
      target,
      { stagingRoot: dir }
    )

    expect(unzipList(target)).toContain('summary.json')
  })

  it('removes the staging directory when zipping fails', async () => {
    const dir = makeDir()
    const staging = path.join(dir, 'staging')
    mkdirSync(staging)
    const log = path.join(dir, 'justspeak.log')
    writeFileSync(log, 'line\n')

    await expect(
      writeDiagnosticsBundle(
        { summary: SUMMARY, logs: [{ name: 'justspeak.log', path: log }], crashDumps: [] },
        path.join(dir, 'broken.zip'),
        {
          stagingRoot: staging,
          zip: async () => {
            throw new Error('zip failed')
          }
        }
      )
    ).rejects.toThrow('zip failed')
    expect(readdirSync(staging)).toEqual([])
  })

  it('zipDirectory produces a readable archive', async () => {
    const dir = makeDir()
    mkdirSync(path.join(dir, 'content'))
    writeFileSync(path.join(dir, 'content', 'a.txt'), 'a\n')
    const target = path.join(dir, 'a.zip')
    await zipDirectory(path.join(dir, 'content'), target)
    expect(unzipList(target)).toContain('a.txt')
  })

  it('names archives with a timestamp and a zip suffix', () => {
    const name = diagnosticsFileName(new Date('2026-11-05T01:02:03.000Z'))
    expect(name).toBe('justspeak-diagnostics-2026-11-05T01-02-03.zip')
  })
})

describe('diagnostics target', () => {
  it('uses the dev override without opening a dialog', async () => {
    const showSaveDialog = async (): Promise<never> => {
      throw new Error('dialog should not open')
    }
    await expect(
      resolveDiagnosticsTarget({ devTarget: '/tmp/out.zip', showSaveDialog })
    ).resolves.toEqual({ canceled: false, target: '/tmp/out.zip' })
  })

  it('resolves a relative dev override to an absolute path', async () => {
    await expect(
      resolveDiagnosticsTarget({
        devTarget: './relative.zip',
        showSaveDialog: async () => ({ canceled: true })
      })
    ).resolves.toEqual({ canceled: false, target: path.resolve('./relative.zip') })
  })

  it('writes nothing when the dialog is canceled or returns no path', async () => {
    await expect(
      resolveDiagnosticsTarget({
        showSaveDialog: async () => ({ canceled: true })
      })
    ).resolves.toEqual({ canceled: true })
    await expect(
      resolveDiagnosticsTarget({
        showSaveDialog: async () => ({ canceled: false })
      })
    ).resolves.toEqual({ canceled: true })
  })

  it('uses the chosen save path', async () => {
    await expect(
      resolveDiagnosticsTarget({
        showSaveDialog: async () => ({ canceled: false, filePath: '/tmp/chosen.zip' })
      })
    ).resolves.toEqual({ canceled: false, target: '/tmp/chosen.zip' })
  })
})
