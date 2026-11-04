import { spawn } from 'node:child_process'
import { copyFile, lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DiagnosticsSummary } from '../../core/diagnostics/summary'

export interface DiagnosticsBundleContents {
  summary: DiagnosticsSummary
  logs: Array<{ name: string; path: string }>
  crashDumps: Array<{ name: string; path: string }>
}

export interface DiagnosticsBundleDeps {
  mkdtemp: typeof mkdtemp
  writeFile: typeof writeFile
  mkdir: typeof mkdir
  copyFile: typeof copyFile
  lstat: typeof lstat
  rename: typeof rename
  rm: typeof rm
  zip: (sourceDirectory: string, target: string) => Promise<void>
  stagingRoot: string
}

export const DIAGNOSTICS_README = `JustSpeak 诊断包

这个压缩包由用户在本机手动导出，应用没有自动上传任何内容。

包含：
- summary.json：应用/运行时版本、平台、权限、供应商状态、运行时/模型是否就绪、偏好摘要（不含密钥与端点 URL）
- logs/：主进程最近的日志（已轮转）
- crash-dumps/：系统为本应用生成的最近崩溃转储（若有）

summary.json 与 logs/ 不包含：
- 转写文本、剪贴板内容、历史记录正文、录音音频
- 词汇表条目
- API Key、端点地址

crash-dumps/ 由操作系统生成，可能包含崩溃瞬间的进程内存（其中可能有临时转写或音频）。若存在，请检查后再分享。
`

/**
 * Zip the staging directory's contents at the archive root. `zip` is used
 * instead of `ditto` so the random staging directory name does not become a
 * top-level folder in the bundle.
 */
export function zipDirectory(sourceDirectory: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/zip', ['-r', '-q', target, '.'], {
      cwd: sourceDirectory,
      stdio: 'ignore'
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`zip exited with code ${String(code)}`))
    })
  })
}

const DEFAULT_DEPS = {
  mkdtemp,
  writeFile,
  mkdir,
  copyFile,
  lstat,
  rename,
  rm,
  zip: zipDirectory
}

async function copyNamed(
  entries: Array<{ name: string; path: string }>,
  directory: string,
  deps: Pick<DiagnosticsBundleDeps, 'mkdir' | 'copyFile' | 'lstat'>
): Promise<void> {
  if (entries.length === 0) return
  await deps.mkdir(directory, { recursive: true })
  const used = new Set<string>()
  for (const entry of entries) {
    try {
      // Defense in depth: never copy a symlink or a non-regular file, even if
      // a caller passes one directly.
      const info = await deps.lstat(entry.path)
      if (!info.isFile() || info.isSymbolicLink()) continue
    } catch {
      continue
    }
    // Never let a crafted basename escape the staging directory.
    const base = path.basename(entry.path) || 'entry'
    let name = base
    let index = 1
    while (used.has(name)) {
      name = `${index}-${base}`
      index += 1
    }
    used.add(name)
    await deps.copyFile(entry.path, path.join(directory, name))
  }
}

/**
 * Write the bundle atomically enough for a user-initiated export: stage,
 * zip, then remove the staging directory. An existing zip at `target` is
 * removed first so entries from an older export cannot survive inside it.
 */
export async function writeDiagnosticsBundle(
  contents: DiagnosticsBundleContents,
  target: string,
  partialDeps: Partial<DiagnosticsBundleDeps> = {}
): Promise<void> {
  const deps: DiagnosticsBundleDeps = { ...DEFAULT_DEPS, ...partialDeps } as DiagnosticsBundleDeps
  if (!deps.stagingRoot) throw new Error('diagnostics staging root is not configured')

  const staging = await deps.mkdtemp(path.join(deps.stagingRoot, 'justspeak-diagnostics-'))
  // Zip next to the target, then rename over it only after zip succeeds: a
  // failed export must not delete the user's previous zip.
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
  try {
    await deps.writeFile(
      path.join(staging, 'summary.json'),
      `${JSON.stringify(contents.summary, null, 2)}\n`,
      'utf8'
    )
    await deps.writeFile(path.join(staging, 'README.txt'), DIAGNOSTICS_README, 'utf8')
    await copyNamed(contents.logs, path.join(staging, 'logs'), deps)
    await copyNamed(contents.crashDumps, path.join(staging, 'crash-dumps'), deps)
    await deps.rm(temporary, { force: true })
    await deps.zip(staging, temporary)
    await deps.rename(temporary, target)
  } finally {
    await deps.rm(temporary, { force: true }).catch(() => undefined)
    await deps.rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function diagnosticsFileName(now = new Date()): string {
  return `justspeak-diagnostics-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`
}
