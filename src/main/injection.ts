import { clipboard, ClipboardItem } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * M0 injection: clipboard + Cmd+V via System Events.
 * Electron 45's clipboard.read() returns the full ClipboardItem list, so the
 * user's clipboard can be restored even for non-text content.
 */
async function snapshotClipboard(): Promise<ClipboardItem[]> {
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

  return snapshots
}

export async function pasteText(text: string): Promise<void> {
  const previous = await snapshotClipboard()
  const previousText = await clipboard.readText()

  await clipboard.writeText(text)
  await delay(60)

  try {
    await execFileAsync(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "v" using command down'],
      { timeout: 3000 }
    )
    await delay(350)
  } catch {
    throw new Error(
      '粘贴失败：请在“系统设置 → 隐私与安全性 → 辅助功能”中允许 JustSpeak（开发时是 Electron）控制键盘。'
    )
  } finally {
    const current = await clipboard.readText()
    if (current === text) {
      try {
        if (previous.length > 0) await clipboard.write(previous)
        else clipboard.clear()
      } catch (error) {
        console.warn('[clipboard] full restore failed; trying text fallback', error)
        try {
          if (previousText) await clipboard.writeText(previousText)
          else clipboard.clear()
        } catch (fallbackError) {
          console.warn('[clipboard] text fallback failed; leaving transcript', fallbackError)
        }
      }
    }
  }
}
