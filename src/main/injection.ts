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
