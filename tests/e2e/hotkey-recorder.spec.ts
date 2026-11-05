import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SKIP = process.env.JUSTSPEAK_E2E === '0' || process.env.JUSTSPEAK_E2E === 'false'
const NEW_CHORD = 'Meta+Alt+Shift+K'
const NEW_ACCELERATOR = 'Command+Alt+Shift+K'

async function launch(): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-e2e-hotkey-'))
  const app = await electron.launch({
    args: [`--user-data-dir=${userData}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ROOT],
    cwd: ROOT,
    env: { ...process.env, JUSTSPEAK_ASR: 'fake' }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.locator('.shell').waitFor({ state: 'visible', timeout: 5_000 })
    const start = page.getByRole('button', { name: '开始使用' })
    if ((await start.count()) > 0) await start.click()
    return { app, page, userData }
  } catch (error) {
    await app.close().catch(() => {})
    rmSync(userData, { recursive: true, force: true })
    throw error
  }
}

async function liveHotkey(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        justspeak: { getPreferences: () => Promise<{ hotkey: string }> }
      }
    ).justspeak
    return (await api.getPreferences()).hotkey
  })
}

test.describe('JustSpeak press-to-record hotkey', () => {
  test.skip(SKIP, 'JUSTSPEAK_E2E=0 disables the Electron E2E suite')
  test.skip(!existsSync(path.join(ROOT, 'out/main/index.js')), 'run `pnpm build` first')
  test.describe.configure({ mode: 'serial' })

  test('records a chord, applies it, and restores on cancel', async () => {
    const { app, page, userData } = await launch()
    try {
      await page.getByRole('button', { name: '设置', exact: true }).click()
      const recorder = page.locator('.hotkey-recorder')
      await expect(recorder).toContainText('⌘')

      await recorder.click()
      await expect(page.getByText(/请按下快捷键/)).toBeVisible()

      // Modifier-only input is a preview, not a binding.
      await page.keyboard.press('Shift')
      await expect(page.getByText('⇧')).toBeVisible()
      await page.keyboard.press(NEW_CHORD)

      await expect
        .poll(() => liveHotkey(page), { timeout: 5_000 })
        .toBe(NEW_ACCELERATOR)
      await expect(recorder).toContainText('K')
      await expect(recorder).toContainText('⌥')
      await expect(recorder).toBeEnabled()

      // Escape cancels without changing the binding that is already live.
      await recorder.click()
      await expect(page.getByText(/请按下快捷键/)).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByText(/请按下快捷键/)).toHaveCount(0)
      expect(await liveHotkey(page)).toBe(NEW_ACCELERATOR)
      await expect(recorder).toBeEnabled()

      // A modifier-less key keeps the recorder armed and explains why.
      await recorder.click()
      await expect(page.getByText(/请按下快捷键/)).toBeVisible()
      await page.keyboard.press('A')
      await expect(page.getByText(/至少一个修饰键/)).toBeVisible()
      await expect(page.getByText(/请按下快捷键/)).toBeVisible()
      await page.keyboard.press('Escape')
      expect(await liveHotkey(page)).toBe(NEW_ACCELERATOR)
    } finally {
      await app.close()
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
