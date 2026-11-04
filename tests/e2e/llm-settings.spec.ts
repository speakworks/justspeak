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

async function launch(): Promise<{ app: ElectronApplication; page: Page; userData: string }> {
  const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-e2e-llm-'))
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

test.describe('JustSpeak LLM settings', () => {
  test.skip(SKIP, 'JUSTSPEAK_E2E=0 disables the Electron E2E suite')
  test.skip(!existsSync(path.join(ROOT, 'out/main/index.js')), 'run `pnpm build` first')
  test.describe.configure({ mode: 'serial' })

  test('offers off/local/endpoint and saves endpoint fields', async () => {
    const { app, page, userData } = await launch()
    try {
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await expect(page.getByText('智能清理', { exact: true })).toBeVisible()

      const select = page.getByLabel('智能清理后端')
      await expect(select).toHaveValue('off')
      await select.selectOption('local')
      await expect(page.getByRole('button', { name: /下载本地模型/ })).toBeVisible()

      await select.selectOption('endpoint')
      await page.getByLabel('智能清理服务地址').fill('http://127.0.0.1:11434')
      await page.getByLabel('智能清理模型名').fill('qwen2.5:1.5b')
      await page.getByRole('button', { name: '保存端点' }).click()
      await expect(page.getByText('端点已保存。')).toBeVisible()

      // The success text must reflect a persisted write, not an optimistic UI
      // update: reload and read the values back from preferences.json.
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
      await page.locator('.shell').waitFor({ state: 'visible', timeout: 5_000 })
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await expect(page.getByLabel('智能清理后端')).toHaveValue('endpoint')
      await expect(page.getByLabel('智能清理服务地址')).toHaveValue('http://127.0.0.1:11434')
      await expect(page.getByLabel('智能清理模型名')).toHaveValue('qwen2.5:1.5b')
    } finally {
      await app.close()
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
