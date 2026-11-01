import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication
} from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SKIP = process.env.JUSTSPEAK_E2E === '0' || process.env.JUSTSPEAK_E2E === 'false'

async function launch(userData: string): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: ['--user-data-dir=' + userData, ROOT],
    cwd: ROOT,
    env: { ...process.env, JUSTSPEAK_ASR: 'fake' },
    timeout: 30_000
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.shell').waitFor({ state: 'visible', timeout: 5_000 })
  return app
}

test.describe('JustSpeak first-run screen', () => {
  test.skip(SKIP, 'JUSTSPEAK_E2E=0 disables the Electron E2E suite')
  test.skip(
    !existsSync(path.join(ROOT, 'out/main/index.js')),
    'run `pnpm build` before the E2E suite'
  )
  test.setTimeout(45_000)

  test('dismisses once and stays dismissed across a restart', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-onboarding-'))
    let app: ElectronApplication | undefined
    try {
      app = await launch(userData)
      let page = await app.firstWindow()
      await expect(page.locator('.onboarding')).toBeVisible()
      await expect(page.locator('.onboarding h1')).toHaveText('欢迎使用 JustSpeak')
      await expect(page.locator('.onboarding-keys kbd')).toHaveCount(3)
      await expect(page.locator('.onboarding-permission')).toHaveCount(2)

      await page.getByRole('button', { name: '开始使用' }).click()
      await expect(page.locator('.onboarding')).toHaveCount(0)

      await app.close()
      app = undefined
      app = await launch(userData)
      page = await app.firstWindow()
      await expect(page.locator('.onboarding')).toHaveCount(0)
    } finally {
      if (app) await app.close().catch(() => {})
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
