import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SKIP = process.env.JUSTSPEAK_E2E === '0' || process.env.JUSTSPEAK_E2E === 'false'

/**
 * Residency: the app outlives its window.
 *
 * These assertions have to run inside the main process — a hidden window and a
 * menu-bar icon are not reachable from the renderer — so the whole test drives
 * `app.evaluate` against the real Electron app rather than the DOM.
 */
async function launch(): Promise<{ app: ElectronApplication; userData: string }> {
  const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-e2e-resident-'))
  const app = await electron.launch({
    args: [
      `--user-data-dir=${userData}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ROOT
    ],
    cwd: ROOT,
    env: { ...process.env, JUSTSPEAK_ASR: 'fake' }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.locator('.shell').waitFor({ state: 'visible', timeout: 5_000 })
    const start = page.getByRole('button', { name: '开始使用' })
    if ((await start.count()) > 0) await start.click()
    return { app, userData }
  } catch (error) {
    await app.close().catch(() => {})
    rmSync(userData, { recursive: true, force: true })
    throw error
  }
}

/**
 * The main window's id, captured while it is the only window.
 *
 * The recording pill and the copy panel are separate `panel` windows created on
 * demand, so `getAllWindows()[0]` is not a stable way to name the main window —
 * once a transcript lands in the copy panel, index 0 is the panel.
 */
async function mainWindowId(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error('no window at launch')
    return window.id
  })
}

async function closeWindow(app: ElectronApplication): Promise<void> {
  const id = await mainWindowId(app)
  await app.evaluate(({ BrowserWindow }, targetId) => {
    // `close()` fires the same handler the title-bar button does. A plain
    // `hide()` would bypass the guard these tests exist to check.
    BrowserWindow.fromId(targetId)?.close()
  }, id)
}

/** Wait for the real capture to report through main's own log line. */
function waitForCaptureStarted(app: ElectronApplication): Promise<void> {
  return new Promise((resolve, reject) => {
    const stdout = app.process().stdout
    if (!stdout) {
      reject(new Error('Electron stdout is unavailable'))
      return
    }
    const timer = setTimeout(() => {
      stdout.off('data', onData)
      reject(new Error('capture did not start within 10 s'))
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

async function mainWindowState(
  app: ElectronApplication,
  id?: number
): Promise<{ exists: boolean; visible: boolean; destroyed: boolean }> {
  const targetId = id ?? (await mainWindowId(app))
  return app.evaluate(({ BrowserWindow }, wanted) => {
    const window = BrowserWindow.fromId(wanted)
    return {
      exists: window !== null,
      visible: window?.isVisible() ?? false,
      destroyed: window?.isDestroyed() ?? true
    }
  }, targetId)
}

test.describe('residency', () => {
  test.skip(SKIP, 'JUSTSPEAK_E2E=0 disables the Electron E2E suite')
  test.describe.configure({ mode: 'serial' })

  test('closing the window hides it instead of ending the app', async () => {
    const { app, userData } = await launch()
    try {
      expect((await mainWindowState(app)).visible).toBe(true)

      await closeWindow(app)

      // The window must still exist: a destroyed window would mean the renderer
      // that owns the microphone is gone, so the hotkey could not dictate.
      await expect
        .poll(async () => (await mainWindowState(app)).visible, { timeout: 5_000 })
        .toBe(false)
      const state = await mainWindowState(app)
      expect(state.exists, 'the window must survive a close').toBe(true)
      expect(state.destroyed).toBe(false)

      // And the process must still be alive with its renderer ready.
      const alive = await app.evaluate(() => process.versions.electron)
      expect(alive).toBeTruthy()
      expect((await mainWindowState(app)).exists).toBe(true)
    } finally {
      await app.close().catch(() => {})
      rmSync(userData, { recursive: true, force: true })
    }
  })

  test('the hidden window keeps capturing and the transcript skips it', async () => {
    const { app, userData } = await launch()
    try {
      // A hidden renderer is throttled by Chromium unless the window opts out.
      // This assertion is the one that fails if `backgroundThrottling: false`
      // is removed, because the audio worklet then stops producing batches.
      expect(
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]
          return (
            window?.webContents as unknown as { backgroundThrottling?: boolean } | undefined
          )?.backgroundThrottling
        }),
        'the capture renderer must not be throttled while hidden'
      ).toBe(false)

      const id = await mainWindowId(app)
      await closeWindow(app)
      await expect
        .poll(async () => (await mainWindowState(app, id)).visible, { timeout: 5_000 })
        .toBe(false)

      // Dictate entirely with the window closed — the path the hotkey and the
      // menu bar both take. Synthetic microphone audio has to travel from the
      // hidden renderer's AudioWorklet, through `capture:pcm`, into main.
      const page = app.windows()[0] ?? (await app.firstWindow())
      const captured = waitForCaptureStarted(app)
      captured.catch(() => {})
      await page.evaluate(() =>
        (globalThis as unknown as { justspeak: { toggleRecording: () => void } }).justspeak.toggleRecording()
      )
      await captured
      await page.waitForTimeout(700)
      await page.evaluate(() =>
        (globalThis as unknown as { justspeak: { toggleRecording: () => void } }).justspeak.toggleRecording()
      )

      // The transcript must not land in the hidden window: it is not focused, so
      // delivery goes to the frontmost app or the copy panel. The id keeps this
      // reading the main window after the copy panel opens as its own window.
      await expect
        .poll(async () => page.locator('.dictation-input').inputValue(), { timeout: 15_000 })
        .toBe('')
      expect((await mainWindowState(app, id)).visible).toBe(false)
    } finally {
      await app.close().catch(() => {})
      rmSync(userData, { recursive: true, force: true })
    }
  })

  test('the Dock icon brings a hidden window back', async () => {
    const { app, userData } = await launch()
    try {
      const id = await mainWindowId(app)
      await closeWindow(app)
      await expect
        .poll(async () => (await mainWindowState(app, id)).visible, { timeout: 5_000 })
        .toBe(false)

      // `activate` is what macOS emits when the Dock icon is clicked. Without a
      // handler the app looks frozen: the icon is there and nothing appears.
      await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'))

      await expect
        .poll(async () => (await mainWindowState(app, id)).visible, { timeout: 5_000 })
        .toBe(true)
    } finally {
      await app.close().catch(() => {})
      rmSync(userData, { recursive: true, force: true })
    }
  })

  test('a requested quit still quits', async () => {
    const { app, userData } = await launch()
    try {
      await closeWindow(app)
      await expect
        .poll(async () => (await mainWindowState(app)).visible, { timeout: 5_000 })
        .toBe(false)

      // `app.quit()` is what Cmd+Q and every 退出 item reach. If the close
      // handler turned this into another hide, `close()` would hang.
      await app.evaluate(({ app: electronApp }) => electronApp.quit())
      // Playwright surfaces a closed app by rejecting further evaluation.
      await expect
        .poll(
          async () => {
            try {
              await app.evaluate(() => 1)
              return 'alive'
            } catch {
              return 'exited'
            }
          },
          { timeout: 15_000 }
        )
        .toBe('exited')
    } finally {
      await app.close().catch(() => {})
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
