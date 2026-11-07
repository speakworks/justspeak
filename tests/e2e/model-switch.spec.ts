import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SKIP = process.env.JUSTSPEAK_E2E === '0' || process.env.JUSTSPEAK_E2E === 'false'

/**
 * The ASR model is set in one place only: the 设置 panel. The app used to repeat
 * a picker in the page header of every other destination, so switching had two
 * entry points and the header one was easy to hit mid-session. This guards the
 * single-entry rule — if someone re-adds a header picker, this fails.
 */
async function launch(
  env: Record<string, string> = {}
): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-e2e-model-'))
  const app = await electron.launch({
    args: [`--user-data-dir=${userData}`, ROOT],
    cwd: ROOT,
    env: { ...process.env, JUSTSPEAK_ASR: 'fake', ...env }
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

test.describe('model switching lives only in settings', () => {
  test.skip(SKIP, 'JUSTSPEAK_E2E=0')

  test('no model picker on 首页 / 词典; 设置 owns the picker', async () => {
    const { app, page, userData } = await launch()
    try {
      // 词典 — the destination that used to carry a header picker.
      await page.getByRole('button', { name: '词典', exact: true }).click()
      await expect(page.getByRole('heading', { name: '词典' })).toBeVisible()
      await expect(page.locator('.page-header select')).toHaveCount(0)
      await page.screenshot({ path: 'test-results/model-switch-dictionary.png' })

      // 首页 — same header, same rule.
      await page.getByRole('button', { name: '首页', exact: true }).click()
      await expect(page.locator('.page-header select')).toHaveCount(0)

      // The sidebar footer names destinations only. It used to repeat the
      // running model in a chip that also opened settings; the provider row in
      // 设置 is now the one place the model is named and switched.
      const foot = page.locator('.sidebar-foot')
      await expect(foot.locator('button')).toHaveCount(1)
      await expect(foot).toContainText('设置')
      await expect(page.locator('.model-chip')).toHaveCount(0)
      await page.screenshot({ path: 'test-results/model-switch-home.png' })

      // 设置 — the one place a picker may live. Under the fake provider main
      // reports no selection, so the row degrades to a single static option.
      await page.getByRole('button', { name: '设置', exact: true }).click()
      const picker = page.getByLabel('识别模型')
      await expect(picker).toBeVisible()
      expect(await picker.locator('option').count()).toBeGreaterThan(0)
      await page.screenshot({ path: 'test-results/model-switch-settings.png' })
    } finally {
      await app.close().catch(() => {})
      rmSync(userData, { recursive: true, force: true })
    }
  })

  test('the settings picker is the live switch: every real provider is listed', async () => {
    // No JUSTSPEAK_ASR override: main starts on the default real provider, so
    // it reports the selectable options (qwen3 + sensevoice). This is the case
    // the header picker used to serve; it now belongs to settings alone.
    // Whether it is *enabled* depends on the model being ready on this machine,
    // so the assertion is on the option list and whether the picker is enabled.
    const { app, page, userData } = await launch({ JUSTSPEAK_ASR: '' })
    try {
      await page.getByRole('button', { name: '设置', exact: true }).click()
      const picker = page.getByLabel('识别模型')
      await expect(picker).toBeVisible()
      expect(await picker.locator('option').count()).toBe(2)
      const selectable = await page.evaluate(async () => {
        const api = (
          globalThis as unknown as {
            justspeak: { getPreferences: () => Promise<{ provider: { selectable: boolean } }> }
          }
        ).justspeak
        const prefs = await api.getPreferences()
        return prefs.provider.selectable
      })
      if (selectable) await expect(picker).toBeEnabled()
      else await expect(picker).toBeDisabled()
      await page.screenshot({ path: 'test-results/model-switch-settings-live.png' })
    } finally {
      await app.close().catch(() => {})
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
