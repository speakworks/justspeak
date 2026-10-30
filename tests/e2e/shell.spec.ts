import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppStatus, JustSpeakApi } from '../../src/shared/ipc'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FAKE_TRANSCRIPT = '你好，这是 JustSpeak 的演示。Hello from JustSpeak.'
const SKIP = process.env.JUSTSPEAK_E2E === '0' || process.env.JUSTSPEAK_E2E === 'false'

/** The renderer global exposed by the sandboxed preload (contextBridge). */
type JustSpeakWindow = { justspeak: JustSpeakApi }

/**
 * A stub `osascript` prepended to PATH. The real paste step shells out to
 * `osascript -e 'tell application "System Events" ...'`; running that against
 * the real OS needs Accessibility permission and would type into whatever app
 * is focused. The E2E substitutes a recorder that exits with the mode's code,
 * so the paste *step* is exercised without touching the OS. Production code is
 * untouched.
 */
function makePasteShim(): { dir: string; calls: string; setMode: (mode: 'ok' | 'fail') => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-e2e-'))
  const calls = path.join(dir, 'calls.log')
  const mode = path.join(dir, 'mode')
  writeFileSync(mode, 'ok')
  const shim = path.join(dir, 'osascript')
  writeFileSync(
    shim,
    `#!/bin/sh
echo "$@" >> "${calls}"
if grep -q fail "${mode}"; then exit 1; fi
exit 0
`
  )
  chmodSync(shim, 0o755)
  return {
    dir,
    calls,
    setMode: (next) => writeFileSync(mode, next)
  }
}

async function launch(
  env: Record<string, string> = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    // `--use-fake-*` make Chromium supply a synthetic microphone: the test never
    // touches a real input device, and its PCM still flows through the real
    // AudioWorklet -> `window.justspeak.sendPcmBatch` IPC path.
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ROOT
    ],
    cwd: ROOT,
    env: {
      ...process.env,
      JUSTSPEAK_ASR: 'fake',
      ...env
    }
  })
  // A launch that dies after the process exists (no window yet, a bad preload)
  // must not leave an Electron app behind for the caller's `finally` — it has
  // not received the handle yet.
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    return { app, page }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
}

/**
 * The app writes the transcript to the real macOS clipboard. When the paste
 * succeeds `pasteTranscript` puts the previous contents back, but a failed
 * paste deliberately leaves the transcript there, so the failure test would
 * otherwise replace whatever the developer had copied. Snapshot inside the
 * main process (ClipboardItems do not survive the CDP bridge) and restore
 * before the app closes.
 */
async function snapshotClipboard(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ clipboard }) => {
    // Electron refuses to write items that came out of `read()`, so the data
    // has to be materialised now and rebuilt on restore.
    const items: Array<Record<string, unknown>> = []
    for (const item of await clipboard.read()) {
      const data: Record<string, unknown> = {}
      for (const type of item.types) data[type] = await item.getType(type)
      items.push(data)
    }
    const store = globalThis as unknown as {
      __justspeakE2EClipboard?: { items: Array<Record<string, unknown>>; text: string }
    }
    store.__justspeakE2EClipboard = { items, text: await clipboard.readText() }
  })
}

async function restoreClipboard(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const saved = (
      globalThis as unknown as {
        __justspeakE2EClipboard?: { items: Array<Record<string, unknown>>; text: string }
      }
    ).__justspeakE2EClipboard
    if (!saved) return
    if (saved.items.length > 0) {
      try {
        await clipboard.write(saved.items.map((data) => new ClipboardItem(data as never)))
      } catch {
        // Rebuilding a rich item can fail (an unsupported type, say). The text
        // half is better than leaving the transcript behind.
        if (saved.text) await clipboard.writeText(saved.text)
        else clipboard.clear()
      }
    } else {
      clipboard.clear()
    }
  })
}

type PasteShim = ReturnType<typeof makePasteShim>

/**
 * One scenario against one fresh app, with teardown that cannot be skipped:
 * the shim directory and the Electron process are released even when the
 * scenario throws before either handle reached the caller — which is exactly
 * what happens when `launch()` itself rejects.
 */
async function withApp(
  scenario: (context: { app: ElectronApplication; page: Page; shim: PasteShim }) => Promise<void>,
  pasteMode: 'ok' | 'fail' = 'ok'
): Promise<void> {
  const shim = makePasteShim()
  shim.setMode(pasteMode)
  let app: ElectronApplication | undefined
  try {
    const launched = await launch({ PATH: `${shim.dir}:${process.env.PATH ?? ''}` })
    app = launched.app
    await snapshotClipboard(app)
    await scenario({ app: launched.app, page: launched.page, shim })
  } finally {
    if (app) {
      // The paste step may have left the transcript on the real clipboard;
      // hand the developer their own contents back before the app goes away.
      try {
        await restoreClipboard(app)
      } catch (error) {
        console.log('RESTORE_FAILED', error)
      }
      await app.close()
    }
    rmSync(shim.dir, { recursive: true, force: true })
  }
}

/**
 * Electron has no headless mode on macOS; hide the window and the Dock icon so
 * a run does not steal focus. Rendering, the AudioWorklet, and IPC keep running
 * while hidden.
 */
async function hideWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    electronApp.dock?.hide()
    for (const window of BrowserWindow.getAllWindows()) window.hide()
  })
}

test.describe('JustSpeak shell', () => {
  test.skip(SKIP, 'JUSTSPEAK_E2E=0 disables the Electron E2E suite')
  test.skip(
    !existsSync(path.join(ROOT, 'out/main/index.js')),
    'run `pnpm build` before the E2E suite'
  )

  // Serial: each test owns a real Electron app and the macOS clipboard.
  test.describe.configure({ mode: 'serial' })

  test('launches the fake provider, dictates, and returns to idle', async () => {
    await withApp(async ({ app, page, shim }) => {
      // 1. Launch: sandboxed preload is live, fake mode is idle, placeholder shown.
      await expect(page.locator('.status')).toHaveText('就绪')
      await hideWindow(app)
      const clipboardBefore = await app.evaluate(({ clipboard }) => clipboard.readText())
      await expect(page.locator('.transcript-text')).toHaveText('还没有文本。按快捷键说一句话。')
      const hasApi = await page.evaluate(
        () => typeof (globalThis as unknown as JustSpeakWindow).justspeak.toggleRecording
      )
      expect(hasApi).toBe('function')

      // 2. Start dictation through the same API the record button calls (the
      //    global hotkey is deliberately not used). Synthetic audio from the
      //    fake device is batched by the renderer and sent over `capture:pcm`.
      await page.evaluate(() =>
        (globalThis as unknown as JustSpeakWindow).justspeak.toggleRecording()
      )
      await expect(page.locator('.status')).toHaveText('录音中')
      await page.waitForTimeout(1_500)

      // 3. Stop and observe the whole pipeline.
      await page.evaluate(() =>
        (globalThis as unknown as JustSpeakWindow).justspeak.toggleRecording()
      )
      await expect(page.locator('.transcript-text')).toHaveText(FAKE_TRANSCRIPT)
      await expect(page.locator('.tag')).toHaveText('FAKE ASR')
      // The recording summary came from the renderer's real capture controller.
      // Its duration is wall-clock, so it does not by itself prove PCM flowed;
      // the transcript assertion above is what depends on real samples (the
      // fake provider returns an empty string for empty input).
      await expect(page.locator('.meta')).toContainText(/录音 [1-9][\d.]*s/)

      await expect(page.locator('.status')).toHaveText('就绪')
      await expect(page.locator('.message')).toHaveCount(0)

      // 4. The paste step was attempted exactly once with the Cmd+V keystroke.
      const calls = readFileSync(shim.calls, 'utf8')
      expect(calls).toContain('System Events')
      expect(calls.trim().split('\n')).toHaveLength(1)

      const status = (await page.evaluate(() =>
        (globalThis as unknown as JustSpeakWindow).justspeak.getState()
      )) as AppStatus
      expect(status.state).toBe('idle')

      // 5. A successful paste put the developer's clipboard back (spec:
      //    dictation-session "Successful paste restores the previous clipboard").
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(clipboardBefore)
    })
  })

  test('keeps the transcript visible when the paste step fails', async () => {
    await withApp(async ({ app, page, shim }) => {
      await expect(page.locator('.status')).toHaveText('就绪')
      await hideWindow(app)
      await page.evaluate(() =>
        (globalThis as unknown as JustSpeakWindow).justspeak.toggleRecording()
      )
      await expect(page.locator('.status')).toHaveText('录音中')
      await page.waitForTimeout(1_500)
      await page.evaluate(() =>
        (globalThis as unknown as JustSpeakWindow).justspeak.toggleRecording()
      )

      await expect(page.locator('.transcript-text')).toHaveText(FAKE_TRANSCRIPT)
      await expect(page.locator('.status')).toHaveText('出错了')
      await expect(page.locator('.message')).toContainText('粘贴失败')
      expect(readFileSync(shim.calls, 'utf8')).toContain('System Events')
      // The failed paste deliberately keeps the text on the clipboard so the
      // user can press Cmd+V by hand (spec: dictation-session).
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(FAKE_TRANSCRIPT)
    }, 'fail')
  })
})
