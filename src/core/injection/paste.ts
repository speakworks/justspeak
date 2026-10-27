export const PASTE_PERMISSION_MESSAGE =
  '粘贴失败：请在“系统设置 → 隐私与安全性 → 辅助功能”中允许 JustSpeak（开发时是 Electron）控制键盘。文本已保留在剪贴板，可手动 Cmd+V。'

export interface ClipboardSnapshot {
  items: unknown[]
  text: string
}

/**
 * Ports keep clipboard and keystroke behavior injectable; the Electron
 * adapter supplies the OS-backed implementation (ADR-0003 injection boundary).
 */
export interface PastePorts {
  snapshot(): Promise<ClipboardSnapshot>
  writeText(text: string): Promise<void>
  readText(): Promise<string>
  restore(snapshot: ClipboardSnapshot): Promise<void>
  clear(): Promise<void>
  pressPaste(): Promise<void>
  delay(ms: number): Promise<void>
  warn(message: string, error?: unknown): void
}

export const CLIPBOARD_WRITE_DELAY_MS = 60
export const PASTE_SETTLE_DELAY_MS = 350

/**
 * Write the transcript, paste once, and restore the previous clipboard only
 * when the clipboard still contains what this function wrote. A user copy
 * during the paste always wins; a failed paste keeps the transcript.
 */
export async function pasteTranscript(text: string, ports: PastePorts): Promise<void> {
  const snapshot = await ports.snapshot()

  await ports.writeText(text)
  await ports.delay(CLIPBOARD_WRITE_DELAY_MS)

  let pasted = false
  try {
    await ports.pressPaste()
    pasted = true
    await ports.delay(PASTE_SETTLE_DELAY_MS)
  } catch (cause) {
    throw new Error(PASTE_PERMISSION_MESSAGE, { cause })
  } finally {
    if (pasted) {
      const current = await ports.readText()
      if (current === text) {
        try {
          if (snapshot.items.length > 0) await ports.restore(snapshot)
          else await ports.clear()
        } catch (error) {
          ports.warn('full clipboard restore failed; trying text fallback', error)
          try {
            if (snapshot.text) await ports.writeText(snapshot.text)
            else ports.warn('no text fallback; leaving transcript')
          } catch (fallbackError) {
            ports.warn('text fallback failed; leaving transcript', fallbackError)
          }
        }
      }
    }
  }
}
