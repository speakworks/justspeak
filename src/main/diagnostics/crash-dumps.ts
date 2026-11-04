import { readdir, lstat } from 'node:fs/promises'
import path from 'node:path'

export interface CrashDumpSelection {
  path: string
  size: number
  modifiedAt: number
}

export interface CrashDumpOptions {
  now?: number
  maxAgeMs?: number
  maxFiles?: number
  maxBytes?: number
}

export interface CrashDumpDeps {
  readdir: typeof readdir
  lstat: typeof lstat
}

const DEFAULT_DEPS: CrashDumpDeps = { readdir, lstat }

/**
 * Select a bounded set of recent crash dumps. Missing directories, permission
 * errors, and unreadable entries are skipped: a diagnostics export must still
 * succeed when the OS never wrote a dump.
 */
export async function collectCrashDumps(
  directory: string,
  options: CrashDumpOptions = {},
  deps: CrashDumpDeps = DEFAULT_DEPS
): Promise<CrashDumpSelection[]> {
  const now = options.now ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000
  const maxFiles = options.maxFiles ?? 10
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024

  let names: string[]
  try {
    names = await deps.readdir(directory)
  } catch {
    return []
  }

  const candidates: CrashDumpSelection[] = []
  for (const name of names) {
    const target = path.join(directory, name)
    try {
      // lstat, not stat: a symlink in the user-writable dump directory must
      // not pull an arbitrary local file into a bundle the user may share.
      const info = await deps.lstat(target)
      if (!info.isFile() || info.isSymbolicLink()) continue
      if (now - info.mtimeMs > maxAgeMs) continue
      candidates.push({ path: target, size: info.size, modifiedAt: info.mtimeMs })
    } catch {
      // A dump that vanished or cannot be read is simply not exported.
    }
  }

  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt)
  const selected: CrashDumpSelection[] = []
  let bytes = 0
  for (const candidate of candidates) {
    if (selected.length >= maxFiles || bytes + candidate.size > maxBytes) continue
    selected.push(candidate)
    bytes += candidate.size
  }
  return selected
}
