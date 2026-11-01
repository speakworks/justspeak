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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FAKE_TRANSCRIPT = '你好，这是 JustSpeak 的演示。Hello from JustSpeak.'
const SKIP = process.env.JUSTSPEAK_E2E === '0' || process.env.JUSTSPEAK_E2E === 'false'

async function launch(
  userData: string,
  shimDir: string
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
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
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.shell').waitFor({ state: 'visible', timeout: 5_000 })
  const start = page.getByRole('button', { name: '开始使用' })
  if ((await start.count()) > 0) await start.click()
  return { app, page }
}

/**
 * The Accessibility probe reads a real frontmost app; a test double makes the
 * "cannot determine" branch deterministic on any machine (it lands on the
 * panel by design). The paste branch is covered by the history spec.
 */
function makeProbeShim(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-panel-shim-'))
  const shim = path.join(dir, 'osascript')
  writeFileSync(
    shim,
    `#!/bin/sh
case "$*" in
  *AXFocusedUIElement*) printf 'UNKNOWN\\n'; exit 0 ;;
esac
exit 0
`
  )
  chmodSync(shim, 0o755)
  return dir
}

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

/** Preserve the developer's whole clipboard, not just its text half. */
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
      __justspeakPanelClipboard?: { items: Array<Record<string, unknown>>; text: string }
    }
    store.__justspeakPanelClipboard = { items, text: await clipboard.readText() }
  })
}

async function restoreClipboard(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const saved = (
      globalThis as unknown as {
        __justspeakPanelClipboard?: { items: Array<Record<string, unknown>>; text: string }
      }
    ).__justspeakPanelClipboard
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

test.describe('JustSpeak copy panel', () => {
  test.skip(SKIP, 'JUSTSPEAK_E2E=0 disables the Electron E2E suite')
  test.skip(
    !existsSync(path.join(ROOT, 'out/main/index.js')),
    'run `pnpm build` before the E2E suite'
  )
  test.setTimeout(60_000)

  test('shows the panel when the focus probe cannot confirm an editable element', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-panel-userdata-'))
    const shimDir = makeProbeShim()
    let app: ElectronApplication | undefined
    try {
      const launched = await launch(userData, shimDir)
      app = launched.app
      const currentApp = launched.app
      const page = launched.page
      await snapshotClipboard(currentApp)

      await expect(page.locator('.status')).toHaveText('就绪')
      await currentApp.evaluate(({ app: electronApp, BrowserWindow }) => {
        electronApp.dock?.hide()
        for (const window of BrowserWindow.getAllWindows()) window.hide()
      })

      const started = waitForCaptureStarted(currentApp)
      started.catch(() => {})
      await page.evaluate(() =>
        (globalThis as unknown as { justspeak: { toggleRecording: () => void } }).justspeak.toggleRecording()
      )
      await started
      await page.waitForTimeout(700)
      const panelPromise = currentApp.waitForEvent('window', { timeout: 15_000 })
      await page.evaluate(() =>
        (globalThis as unknown as { justspeak: { toggleRecording: () => void } }).justspeak.toggleRecording()
      )

      const panel = await panelPromise
      await panel.waitForLoadState('domcontentloaded')
      expect(panel.url()).toContain('panel=1')
      await expect(panel.locator('.result-panel-title')).toHaveText('焦点不在输入框')
      await expect(panel.locator('.result-panel-text')).toHaveText(FAKE_TRANSCRIPT)
      await expect(panel.getByRole('button', { name: '复制' })).toBeVisible()

      await panel.getByRole('button', { name: '复制' }).click()
      await expect
        .poll(() => currentApp.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe(FAKE_TRANSCRIPT)
      await expect
        .poll(() =>
          currentApp.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().every((window) => !window.isVisible())
          )
        )
        .toBe(true)

      const file = path.join(userData, 'history', 'entries.jsonl')
      await expect.poll(() => existsSync(file)).toBe(true)
      const entry = JSON.parse(readFileSync(file, 'utf8').trim().split('\n')[0]) as {
        outcome: string
        text: string
      }
      expect(entry.text).toBe(FAKE_TRANSCRIPT)
      expect(entry.outcome).toBe('panel')
    } finally {
      if (app) {
        await restoreClipboard(app).catch(() => {})
        await app.close().catch(() => {})
      }
      rmSync(userData, { recursive: true, force: true })
      rmSync(shimDir, { recursive: true, force: true })
    }
  })
})
