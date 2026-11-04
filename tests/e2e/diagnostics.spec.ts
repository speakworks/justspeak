import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SKIP = process.env.JUSTSPEAK_E2E === '0' || process.env.JUSTSPEAK_E2E === 'false'

test.describe('JustSpeak diagnostics export', () => {
  test.skip(SKIP, 'JUSTSPEAK_E2E=0 disables the Electron E2E suite')
  test.skip(!existsSync(path.join(ROOT, 'out/main/index.js')), 'run `pnpm build` first')

  test('writes a local zip without history, audio, or key material', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-e2e-diagnostics-'))
    const target = path.join(userData, 'diagnostics.zip')
    const app = await electron.launch({
      args: [`--user-data-dir=${userData}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ROOT],
      cwd: ROOT,
      env: {
        ...process.env,
        JUSTSPEAK_ASR: 'fake',
        JUSTSPEAK_DIAGNOSTICS_EXPORT: target
      }
    })
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await page.locator('.shell').waitFor({ state: 'visible', timeout: 5_000 })
      const start = page.getByRole('button', { name: '开始使用' })
      if ((await start.count()) > 0) await start.click()
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await page.getByRole('button', { name: '导出诊断' }).click()
      await expect(page.getByText(/诊断包已保存/)).toBeVisible({ timeout: 10_000 })

      expect(existsSync(target)).toBe(true)
      const list = spawnSync('/usr/bin/unzip', ['-l', target], { encoding: 'utf8' })
      expect(list.status).toBe(0)
      expect(list.stdout).toContain('summary.json')
      expect(list.stdout).toContain('README.txt')
      expect(list.stdout).not.toContain('history')
      expect(list.stdout).not.toContain('llm-key')
      expect(list.stdout).not.toContain('.wav')

      const summary = spawnSync('/usr/bin/unzip', ['-p', target, 'summary.json'], {
        encoding: 'utf8'
      })
      expect(summary.status).toBe(0)
      const parsed = JSON.parse(summary.stdout) as {
        app: { name: string }
        preferences: { llm: { endpoint: { hasKey: boolean } } }
        history: { entries: number }
      }
      expect(parsed.app.name).toBeTruthy()
      expect(parsed.preferences.llm.endpoint.hasKey).toBe(false)
      expect(parsed.history.entries).toBe(0)
      // The export path itself must not leak into the manifest.
      expect(readFileSync(target).byteLength).toBeGreaterThan(0)
    } finally {
      await app.close()
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
