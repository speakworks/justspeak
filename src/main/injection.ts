import { clipboard, ClipboardItem } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  pasteTranscript,
  type ClipboardSnapshot,
  type PastePorts
} from '../core/injection/paste'

const execFileAsync = promisify(execFile)

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function snapshotClipboard(): Promise<ClipboardSnapshot> {
  const items = await clipboard.read()
  const snapshots: ClipboardItem[] = []

  for (const item of items) {
    // An empty clipboard can still yield one item with no types; constructing
    // a ClipboardItem from an empty map throws and would turn a normal paste
    // into a failure.
    if (item.types.length === 0) continue
    const data: Record<string, string | Blob | Electron.ClipboardBookmark> = {}
    for (const type of item.types) {
      const value = await item.getType(type)
      data[type] = value as string | Blob | Electron.ClipboardBookmark
    }
    snapshots.push(new ClipboardItem(data))
  }

  return { items: snapshots, text: await clipboard.readText() }
}

const ports: PastePorts = {
  snapshot: snapshotClipboard,
  writeText: (text) => clipboard.writeText(text),
  readText: () => Promise.resolve(clipboard.readText()),
  restore: async (snapshot) => {
    if (snapshot.items.length > 0) await clipboard.write(snapshot.items as ClipboardItem[])
  },
  clear: async () => {
    clipboard.clear()
  },
  pressPaste: async () => {
    await execFileAsync(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "v" using command down'],
      // Safety net only. A 3s cap was demonstrably too tight: on a loaded
      // machine Electron's spawn of `osascript` sometimes exceeds it, Node
      // kills the child before it runs, and paste.ts then reports the
      // accessibility-permission message — a misleading error for what is
      // actually a slow launch (measured 3.0s vs 20-40ms normally). A genuine
      // permission problem returns from System Events in well under a second,
      // so a generous cap costs nothing in that case.
      { timeout: 10_000 }
    )
  },
  delay,
  warn: (message, error) => console.warn('[clipboard]', message, error ?? '')
}

/**
 * M0/M1 injection adapter: clipboard + Cmd+V via System Events.
 * Snapshot/restore/failure policy lives in src/core/injection/paste.ts.
 */
export async function pasteText(text: string): Promise<void> {
  await pasteTranscript(text, ports)
}

export const DELETE_PERMISSION_MESSAGE =
  '撤销失败：请在“系统设置 → 隐私与安全性 → 辅助功能”中允许 JustSpeak 控制键盘。'

/**
 * Bring a still-running app back to the front so an explicit undo issued from
 * JustSpeak's own menu or history can act on it. `open -b` goes through
 * LaunchServices, not Apple Events, so it adds no Automation permission.
 *
 * A closed app is never launched: the user's target is gone, and starting it
 * would be a surprising side effect of pressing undo. The caller re-probes and
 * still requires the full guard afterwards, so a returned app whose focused
 * element changed is still a refusal.
 */
export async function activateRunningApp(bundleId: string): Promise<boolean> {
  if (!/^[A-Za-z0-9.-]+$/.test(bundleId)) return false
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      [
        '-e',
        `tell application "System Events" to return exists (first application process whose bundle identifier is "${bundleId}")`
      ],
      { timeout: 5_000 }
    )
    if (String(stdout).trim() !== 'true') return false
    await execFileAsync('open', ['-b', bundleId], { timeout: 5_000 })
    return true
  } catch (error) {
    console.warn('[undo] could not bring the recorded app forward', error)
    return false
  }
}

/**
 * Delete exactly `count` grapheme clusters with Backspace.
 *
 * This is the only delete path in the app, and it is called only after the
 * undo guard positively confirms the same editable target. A non-positive or
 * non-finite count is a no-op rather than an unbounded key storm.
 */
export async function deleteCharacters(count: number): Promise<void> {
  const presses = Math.floor(count)
  if (!Number.isFinite(presses) || presses <= 0) return
  const script = `
tell application "System Events"
  repeat ${presses} times
    key code 51
  end repeat
end tell
`
  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 20_000 })
  } catch (cause) {
    throw new Error(DELETE_PERMISSION_MESSAGE, { cause })
  }
}
