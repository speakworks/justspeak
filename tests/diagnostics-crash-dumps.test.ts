import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectCrashDumps } from '../src/main/diagnostics/crash-dumps'

const directories: string[] = []
const DAY = 24 * 60 * 60 * 1000

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-crash-dumps-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('crash dump selection', () => {
  it('selects recent regular files, newest first, and skips old or nested entries', async () => {
    const dir = makeDir()
    const now = Date.now()
    writeFileSync(path.join(dir, 'old.dmp'), '0123456789')
    utimesSync(path.join(dir, 'old.dmp'), new Date(now - 40 * DAY), new Date(now - 40 * DAY))
    writeFileSync(path.join(dir, 'newer.dmp'), '0123456789')
    utimesSync(path.join(dir, 'newer.dmp'), new Date(now - 1 * DAY), new Date(now - 1 * DAY))
    writeFileSync(path.join(dir, 'newest.dmp'), '0123456789')
    utimesSync(path.join(dir, 'newest.dmp'), new Date(now - 60 * 1000), new Date(now - 60 * 1000))
    mkdirSync(path.join(dir, 'nested.dmp'))

    const selected = await collectCrashDumps(dir, { now })
    expect(selected.map((dump) => path.basename(dump.path))).toEqual([
      'newest.dmp',
      'newer.dmp'
    ])
  })

  it('caps file count and total bytes', async () => {
    const dir = makeDir()
    const now = Date.now()
    for (let index = 0; index < 4; index += 1) {
      const name = `dump-${index}.dmp`
      writeFileSync(path.join(dir, name), 'x'.repeat(10))
      const at = new Date(now - index * 1000)
      utimesSync(path.join(dir, name), at, at)
    }
    const byCount = await collectCrashDumps(dir, { now, maxFiles: 2 })
    expect(byCount).toHaveLength(2)
    const byBytes = await collectCrashDumps(dir, { now, maxBytes: 15 })
    expect(byBytes).toHaveLength(1)
  })

  it('rejects a symlink instead of following it to an arbitrary file', async () => {
    const root = makeDir()
    const dumps = path.join(root, 'dumps')
    mkdirSync(dumps)
    const secret = path.join(root, 'secret.txt')
    writeFileSync(secret, 'TOP-SECRET')
    symlinkSync(secret, path.join(dumps, 'crash.ips'))
    await expect(collectCrashDumps(dumps)).resolves.toEqual([])
  })

  it('returns an empty list when the directory does not exist', async () => {
    await expect(
      collectCrashDumps(path.join(tmpdir(), 'justspeak-missing-crash-dumps'))
    ).resolves.toEqual([])
  })
})
