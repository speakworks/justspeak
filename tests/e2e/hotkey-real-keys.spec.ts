/**
 * Real system keyboard checks — opt-in.
 *
 * Playwright's synthetic key events never reach the native menu or the system
 * level, so two product promises have never actually been tested: that
 * `globalShortcut` accepts `Command+'`, and that capturing a new shortcut does
 * not let `Cmd+Q` / `Cmd+R` through. This spec sends real key events.
 *
 * Run it yourself, from a terminal opened on the Mac:
 *
 *   JUSTSPEAK_REAL_KEYS=1 npx playwright test tests/e2e/hotkey-real-keys.spec.ts
 *
 * Expected: 2 passed.
 *
 * Prerequisites, all checked at the start of the run:
 *   - macOS with an unlocked screen and an Aqua GUI session;
 *   - Accessibility for the process that runs the tests;
 *   - Automation consent for System Events on first use;
 *   - no other JustSpeak instance running. The harness starts its own instance
 *     with its own user-data directory and refuses to send a key unless that
 *     instance is still frontmost at the moment the AppleScript runs.
 *
 * When a prerequisite is missing the spec FAILS with the reason printed. It
 * never downgrades to a skip: see
 * `openspec/specs/real-machine-verification/spec.md`.
 */
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
import {
  assertRealMachineGrants,
  keystrokeToPid,
  type RealKeyResult
} from './real-machine'

const ENABLED = process.env.JUSTSPEAK_REAL_KEYS === '1'
test.skip(
  !ENABLED,
  'Real keyboard checks are opt-in: run JUSTSPEAK_REAL_KEYS=1 npx playwright test tests/e2e/hotkey-real-keys.spec.ts'
)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

interface JustSpeakPage {
  justspeak: {
    toggleRecording: () => void
    getPreferences: () => Promise<{ hotkey: string }>
    getState: () => Promise<{ state: string }>
  }
}

async function launchOwnInstance(): Promise<{
  app: ElectronApplication
  page: Page
  userData: string
}> {
  const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-real-keys-'))
  const app = await electron.launch({
    args: [
      `--user-data-dir=${userData}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ROOT
    ],
    cwd: ROOT,
    env: { ...process.env, JUSTSPEAK_ASR: 'fake', JUSTSPEAK_E2E: '1' },
    timeout: 30_000
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

/**
 * Wait until the test instance owns the keyboard, then send the chord. The
 * frontmost check happens inside the same AppleScript as the keystroke, so a
 * focus change cannot redirect it to another application.
 */
async function sendWhenFrontmost(
  app: ElectronApplication,
  text: string,
  using: string[]
): Promise<void> {
  const pid = await app.evaluate(() => process.pid)
  const deadline = Date.now() + 10_000
  let result: RealKeyResult = 'not-frontmost'
  while (Date.now() < deadline) {
    result = keystrokeToPid(pid, text, using)
    if (result === 'ok') return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(
    'The test instance never became the frontmost process, so no key was sent. Make sure it is the active window and retry.'
  )
}

async function liveHotkey(page: Page): Promise<string> {
  return page.evaluate(async () =>
    (globalThis as unknown as JustSpeakPage).justspeak.getPreferences().then(
      (value) => value.hotkey
    )
  )
}

async function appState(page: Page): Promise<string> {
  return page.evaluate(async () =>
    (globalThis as unknown as JustSpeakPage).justspeak.getState().then(
      (value) => value.state
    )
  )
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  assertRealMachineGrants()
})

test("Command+' is accepted by globalShortcut and starts a recording", async () => {
  const { app, page, userData } = await launchOwnInstance()
  try {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const recorder = page.locator('.hotkey-recorder')
    await expect(recorder).toBeEnabled()

    // Capture the chord through the real system path, not through a synthetic
    // key event: this is the part that could not be tested before.
    await recorder.click()
    await expect(page.getByText(/请按下快捷键/)).toBeVisible()
    await sendWhenFrontmost(app, "'", ['command'])
    await expect.poll(() => liveHotkey(page), { timeout: 10_000 }).toBe(
      "Command+'"
    )
    await expect(page.getByText(/请按下快捷键/)).toHaveCount(0)

    // The same chord now arrives as a global shortcut while the app owns it.
    await sendWhenFrontmost(app, "'", ['command'])
    await expect.poll(() => appState(page), { timeout: 10_000 }).toBe('recording')

    // Leave the machine idle again and let the pipeline finish before closing.
    await page.evaluate(() =>
      (globalThis as unknown as JustSpeakPage).justspeak.toggleRecording()
    )
    await expect.poll(() => appState(page), { timeout: 20_000 }).toBe('idle')
  } finally {
    await app.close().catch(() => {})
    rmSync(userData, { recursive: true, force: true })
  }
})

test('Command+Q during capture is reserved, not obeyed', async () => {
  const { app, page, userData } = await launchOwnInstance()
  try {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const recorder = page.locator('.hotkey-recorder')
    await expect(recorder).toBeEnabled()

    await recorder.click()
    await expect(page.getByText(/请按下快捷键/)).toBeVisible()

    // `src/core/hotkey/capture.ts` lists Command+Q as reserved and the recorder
    // suppresses the native menu so the chord reaches it. If either half were
    // broken, this keystroke would quit the application.
    await sendWhenFrontmost(app, 'q', ['command'])

    await expect(page.locator('#settings-hotkey-message')).toContainText(
      'macOS 占用',
      { timeout: 10_000 }
    )

    // Give a real quit a moment to happen, then prove it did not.
    await page.waitForTimeout(1_500)
    expect(app.process().exitCode).toBeNull()
    await expect(page.locator('.shell')).toBeVisible()

    // Leave capture cleanly so the instance can close on its own terms.
    await page.keyboard.press('Escape')
  } finally {
    await app.close().catch(() => {})
    rmSync(userData, { recursive: true, force: true })
  }
})
