import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DiagnosticsLog } from '../src/main/diagnostics/log'

const directories: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-diagnostics-log-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('diagnostics log', () => {
  it('appends timestamped, redacted lines and flushes', async () => {
    const dir = makeDir()
    const file = path.join(dir, 'logs/justspeak.log')
    const log = new DiagnosticsLog({
      file,
      redaction: { homeDir: '/Users/alice' }
    })
    log.write('info', 'hello /Users/alice/notes.txt')
    log.write('warn', 'second %s', 'line')
    await log.flush()

    const content = readFileSync(file, 'utf8')
    expect(content).toContain('[info] hello <home>/notes.txt')
    expect(content).toContain('[warn] second line')
    expect(content.split('\n').filter(Boolean)).toHaveLength(2)
  })

  it('rotates by size and keeps the configured number of backups', async () => {
    const dir = makeDir()
    const file = path.join(dir, 'justspeak.log')
    const log = new DiagnosticsLog({ file, maxBytes: 120, backups: 2 })
    for (let index = 0; index < 8; index += 1) {
      log.write('info', `line-${index}-${'x'.repeat(40)}`)
    }
    await log.flush()

    expect(statSync(file).size).toBeLessThanOrEqual(120)
    expect(readFileSync(`${file}.1`, 'utf8')).toContain('line-')
    expect(readFileSync(`${file}.2`, 'utf8')).toContain('line-')
    expect(readFileSync(file, 'utf8')).toContain('line-7')
  })

  it('tees console output without changing terminal behavior and restores it', async () => {
    const dir = makeDir()
    const file = path.join(dir, 'justspeak.log')
    const log = new DiagnosticsLog({
      file,
      redaction: { homeDir: '/Users/alice' }
    })
    const restore = log.installConsoleTee()
    try {
      console.info('tee /Users/alice/value')
    } finally {
      restore()
    }
    await log.flush()
    expect(readFileSync(file, 'utf8')).toContain('[info] tee <home>/value')
  })

  it('does not follow a symlink planted at the log path', async () => {
    const dir = makeDir()
    const secret = path.join(dir, 'secret.txt')
    writeFileSync(secret, 'secret')
    const file = path.join(dir, 'justspeak.log')
    symlinkSync(secret, file)
    const log = new DiagnosticsLog({ file })
    log.write('info', 'must not reach the symlink target')
    await expect(log.flush()).resolves.toBeUndefined()
    expect(readFileSync(secret, 'utf8')).toBe('secret')
  })

  it('does not reject when the log directory cannot be created', async () => {
    const dir = makeDir()
    const file = path.join(dir, 'not-a-directory/justspeak.log')
    writeFileSync(path.join(dir, 'not-a-directory'), 'file')
    const log = new DiagnosticsLog({ file })
    log.write('error', 'disk full')
    await expect(log.flush()).resolves.toBeUndefined()
  })
})
