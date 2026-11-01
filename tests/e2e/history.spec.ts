import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FAKE_TRANSCRIPT = '你好，这是 JustSpeak 的演示。Hello from JustSpeak.'
const SKIP = process.env.JUSTSPEAK_E2E === '0' || process.env.JUSTSPEAK_E2E === 'false'

type JustSpeakWindow = {
  justspeak: {
    toggleRecording: () => void
    getHistory: () => Promise<unknown[]>
  }
}

/**
 * Test double for both osascript uses: the focus probe answers "editable" so
 * the paste path runs, and the synthesized keystroke is a no-op.
 */
function makePasteShim(): { dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-history-e2e-'))
  const shim = path.join(dir, 'osascript')
  writeFileSync(
    shim,
    `#!/bin/sh
case "$*" in
  *AXFocusedUIElement*) printf 'AXTextArea|1\\n'; exit 0 ;;
esac
exit 0
`
  )
  chmodSync(shim, 0o755)
  return { dir }
}

async function launch(
  userData: string,
  shimDir: string
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    // A private userData keeps this run out of the developer's real history.
    args: [
      `--user-data-dir=${userData}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ROOT
    ],
    cwd: ROOT,
    env: {
      ...process.env,
      JUSTSPEAK_ASR: 'fake',
      PATH: `${shimDir}:${process.env.PATH ?? ''}`
    },
    timeout: 30_000
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.locator('.shell').waitFor({ state: 'visible', timeout: 5_000 })
    const start = page.getByRole('button', { name: '开始使用' })
    if ((await start.count()) > 0) await start.click()
    return { app, page }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
}

async function hideWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    electronApp.dock?.hide()
    for (const window of BrowserWindow.getAllWindows()) window.hide()
  })
}


async function showWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    electronApp.dock?.show()
    for (const window of BrowserWindow.getAllWindows()) window.show()
  })
}

/**
 * Wait for main's capture-started log instead of sleeping. The first capture on
 * a cold machine can take seconds; a fixed sleep either flakes or records an
 * empty clip that still ends in `就绪`.
 */
function waitForCaptureStarted(app: ElectronApplication): Promise<void> {
  return new Promise((resolve, reject) => {
    const stdout = app.process().stdout
    if (!stdout) {
      reject(new Error('Electron stdout is unavailable'))
      return
    }
    const timer = setTimeout(() => {
      stdout.off('data', onData)
      reject(new Error('capture did not start within 10s'))
    }, 10_000)
    const onData = (chunk: Buffer): void => {
      if (!chunk.toString().includes('[capture] started')) return
      clearTimeout(timer)
      stdout.off('data', onData)
      resolve()
    }
    stdout.on('data', onData)
  })
}

async function dictate(app: ElectronApplication, page: Page): Promise<void> {
  const started = waitForCaptureStarted(app)
  // If the status assertion throws first, this promise would reject unhandled.
  started.catch(() => {})
  await page.evaluate(() =>
    (globalThis as unknown as JustSpeakWindow).justspeak.toggleRecording()
  )
  await expect(page.locator('.status')).toHaveText('录音中')
  await started
  // Keep the device open long enough for a real, non-empty clip.
  await page.waitForTimeout(700)
  await page.evaluate(() =>
    (globalThis as unknown as JustSpeakWindow).justspeak.toggleRecording()
  )
  await expect(page.locator('.status')).toHaveText('就绪', { timeout: 15_000 })
}

async function openHistory(page: Page): Promise<void> {
  await page.getByRole('button', { name: '历史记录' }).click()
  await expect(page.locator('.history')).toBeVisible()
}

async function clickRowButton(page: Page, label: string): Promise<void> {
  await page.locator('.history-row').first().getByRole('button', { name: label }).click()
}

/** Preserve the developer's clipboard; the copy assertion changes it. */
async function snapshotClipboard(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ clipboard }) => {
    const items: Array<Record<string, unknown>> = []
    for (const item of await clipboard.read()) {
      if (item.types.length === 0) continue
      const data: Record<string, unknown> = {}
      for (const type of item.types) data[type] = await item.getType(type)
      items.push(data)
    }
    const store = globalThis as unknown as {
      __justspeakHistoryClipboard?: { items: Array<Record<string, unknown>>; text: string }
    }
    store.__justspeakHistoryClipboard = { items, text: await clipboard.readText() }
  })
}

async function restoreClipboard(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const saved = (
      globalThis as unknown as {
        __justspeakHistoryClipboard?: { items: Array<Record<string, unknown>>; text: string }
      }
    ).__justspeakHistoryClipboard
    if (!saved) return
    try {
      if (saved.items.length > 0) {
        await clipboard.write(saved.items.map((data) => new ClipboardItem(data as never)))
      } else if (saved.text) {
        await clipboard.writeText(saved.text)
      } else {
        clipboard.clear()
      }
    } catch {
      if (saved.text) await clipboard.writeText(saved.text)
      else clipboard.clear()
    }
  })
}

test.describe('JustSpeak history', () => {
  test.skip(SKIP, 'JUSTSPEAK_E2E=0 disables the Electron E2E suite')
  test.skip(
    !existsSync(path.join(ROOT, 'out/main/index.js')),
    'run `pnpm build` before the E2E suite'
  )
  test.setTimeout(60_000)

  test('records a transcript and WAV, survives restart, copies and deletes', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-history-userdata-'))
    const shim = makePasteShim()
    let app: ElectronApplication | undefined
    try {
      const launched = await launch(userData, shim.dir)
      app = launched.app
      let page = launched.page
      await snapshotClipboard(app)
      await expect(page.locator('.status')).toHaveText('就绪')
      await hideWindow(app)
      await dictate(app, page)
      await showWindow(app)

      const file = path.join(userData, 'history', 'entries.jsonl')
      await expect.poll(() => existsSync(file)).toBe(true)
      const entry = JSON.parse(readFileSync(file, 'utf8').trim().split('\n')[0]) as {
        text: string
        outcome: string
        audio?: { file: string }
      }
      expect(entry.text).toBe(FAKE_TRANSCRIPT)
      expect(entry.outcome).toBe('pasted')
      expect(entry.audio).toBeTruthy()
      const wavPath = path.join(userData, 'history', entry.audio?.file ?? '')
      const wav = readFileSync(wavPath)
      expect(wav.subarray(0, 4).toString()).toBe('RIFF')

      await openHistory(page)
      await expect(page.locator('.history-row')).toHaveCount(1)
      await expect(page.locator('.history-text')).toHaveText(FAKE_TRANSCRIPT)
      await expect(page.locator('.history-outcome')).toHaveText('已粘贴')
      await expect(page.getByRole('button', { name: '播放' })).toBeVisible()

      await clickRowButton(page, '复制')
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(FAKE_TRANSCRIPT)
      // Restore before this process (and its snapshot) goes away; the restarted
      // app has no copy of the developer's original clipboard.
      await restoreClipboard(app)

      // A fresh process on the same userData proves the row and WAV are on disk.
      await app.close()
      app = undefined
      const restarted = await launch(userData, shim.dir)
      app = restarted.app
      page = restarted.page
      await openHistory(page)
      await expect(page.locator('.history-row')).toHaveCount(1)

      await clickRowButton(page, '删除')
      await expect(page.locator('.history-row')).toHaveCount(0)
      await expect(page.locator('.pane-empty-title')).toBeVisible()
      expect(existsSync(wavPath)).toBe(false)
      expect(readFileSync(file, 'utf8').trim()).toBe('')
    } finally {
      if (app) {
        await restoreClipboard(app).catch(() => {})
        await app.close().catch(() => {})
      }
      rmSync(userData, { recursive: true, force: true })
      rmSync(shim.dir, { recursive: true, force: true })
    }
  })
})
