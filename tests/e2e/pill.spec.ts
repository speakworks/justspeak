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

async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
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
      // Keep the transcribing state open long enough to inspect the walk.
      JUSTSPEAK_FAKE_DELAY_MS: '1500'
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

test.describe('JustSpeak recording pill', () => {
  test.skip(SKIP, 'JUSTSPEAK_E2E=0 disables the Electron E2E suite')
  test.skip(
    !existsSync(path.join(ROOT, 'out/main/index.js')),
    'run `pnpm build` before the E2E suite'
  )
  test.setTimeout(45_000)

  test('freezes the waveform and walks a lit bar to the last one', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-pill-'))
    let app: ElectronApplication | undefined
    try {
      const launched = await launch(userData)
      app = launched.app
      const currentApp = launched.app
      const page = launched.page
      await expect(page.locator('.status')).toHaveText('就绪')
      // Exercise the light palette: the walk must use the light accent, not the
      // dark one left over on the overlay document.
      await page.evaluate(() =>
        (
          globalThis as unknown as {
            justspeak: { setPreferences: (patch: { theme: string }) => Promise<unknown> }
          }
        ).justspeak.setPreferences({ theme: 'light' })
      )

      const overlayPromise = currentApp.waitForEvent('window', { timeout: 10_000 })
      const started = waitForCaptureStarted(currentApp)
      started.catch(() => {})
      await page.evaluate(() =>
        (globalThis as unknown as { justspeak: { toggleRecording: () => void } }).justspeak.toggleRecording()
      )
      const overlay = await overlayPromise
      await overlay.waitForLoadState('domcontentloaded')
      expect(overlay.url()).toContain('overlay=1')
      await expect(overlay.locator('.pill-bars')).toBeVisible()

      await started
      await page.waitForTimeout(700)
      await page.evaluate(() =>
        (globalThis as unknown as { justspeak: { toggleRecording: () => void } }).justspeak.toggleRecording()
      )

      await expect(overlay.locator('.pill')).toHaveClass(/is-working/)
      await expect(overlay.locator('.pill')).toHaveClass(/pill-light/)
      await expect(overlay.locator('.pill-btn')).toHaveCount(0)
      await expect(overlay.locator('.pill')).toHaveText('')
      await expect(overlay.locator('.pill-bars span')).toHaveCount(17)

      // The working bars keep the resting-geometry dash: 2px wide and scaled to
      // the same height as the flat waveform. Only the colour changes.
      const pending = overlay.locator('.pill-bars span:not(.active):not(.passed)').first()
      await expect(pending).toHaveCSS('width', '2px')
      await expect(pending).toHaveCSS('height', '16px')
      await expect(pending).toHaveCSS('transform', 'matrix(1, 0, 0, 0.11, 0, 0)')

      // The lit bar walks right as the fake provider keeps working.
      await expect
        .poll(() =>
          overlay.locator('.pill-bars span').evaluateAll((dots) =>
            dots.findIndex((dot) => dot.classList.contains('active'))
          )
        )
        .toBeGreaterThan(0)
      await expect
        .poll(() =>
          overlay.locator('.pill-bars span.passed').count()
        )
        .toBeGreaterThan(0)
      await expect(overlay.locator('.pill-bars span.passed').first()).toHaveCSS(
        'background-color',
        'rgb(44, 106, 78)'
      )

      // Delivery arrives before the 16-step walk finishes: the highlight jumps
      // to the last bar; the pill is hidden only after that completion beat.
      await expect
        .poll(
          () =>
            overlay.locator('.pill-bars span').evaluateAll((dots) => {
              const last = dots[dots.length - 1]
              return {
                activeLast: last.classList.contains('active'),
                passed: dots.filter((dot) => dot.classList.contains('passed')).length
              }
            }),
          { timeout: 10_000 }
        )
        .toEqual({ activeLast: true, passed: 16 })

      await expect
        .poll(() =>
          currentApp.evaluate(({ BrowserWindow }) => {
            const target = BrowserWindow.getAllWindows().find((window) =>
              window.webContents.getURL().includes('overlay=1')
            )
            return target?.getBounds().width ?? 0
          })
        )
        .toBe(132)
      await expect(page.locator('.status')).toHaveText('就绪', { timeout: 10_000 })
    } finally {
      if (app) await app.close().catch(() => {})
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
