/**
 * Real-machine checks for the correction path — opt-in.
 *
 * The shim-based suite (`undo.spec.ts`) replaces `osascript`, so it proves the
 * decision logic and nothing about macOS. These cases run the real interpreter
 * against TextEdit, which is the only way to answer "does the delete path
 * actually work?".
 *
 * Run it yourself, from a terminal opened on the Mac:
 *
 *   JUSTSPEAK_REAL_AX=1 npx playwright test tests/e2e/undo-real-ax.spec.ts
 *
 * Expected: 3 passed.
 *
 * Prerequisites, all checked at the start of the run:
 *   - macOS with an unlocked screen;
 *   - an Aqua GUI session (an SSH or tmux login lives in the launchd
 *     "Background" domain and cannot activate or drive other apps);
 *   - Accessibility for the process that runs the tests;
 *   - Automation consent for System Events on first use;
 *   - **TextEdit not running.** The spec opens its own documents in its own
 *     TextEdit instance and closes only those files; if TextEdit is already
 *     running, `open` would reuse it and closing could discard your unsaved
 *     work, so the run refuses to start instead.
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
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  activateApp,
  assertRealMachineGrants,
  assertTextEditIdle,
  closeTextEditDocuments,
  focusTextEditDocument,
  frontmostApp,
  graphemeCount,
  openTextEditDocument,
  quitTextEdit,
  readTextEditDocument
} from './real-machine'

const ENABLED = process.env.JUSTSPEAK_REAL_AX === '1'
test.skip(
  !ENABLED,
  'Real AX checks are opt-in: run JUSTSPEAK_REAL_AX=1 npx playwright test tests/e2e/undo-real-ax.spec.ts'
)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TRANSCRIPT = '这是真机验证用的文本。'
const ORIGINAL = '起点文本'

interface JustSpeakPage {
  justspeak: {
    toggleRecording: () => void
    getUndoState: () => Promise<{ available: boolean; entryId?: string }>
    undoLastInjection: () => Promise<{ ok: boolean; message?: string }>
  }
}

async function launchApp(
  userData: string
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [
      `--user-data-dir=${userData}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ROOT
    ],
    cwd: ROOT,
    // No JUSTSPEAK_E2E_* variables: those swap in the shim. This spec exists to
    // exercise the real `osascript` path.
    env: { ...process.env, JUSTSPEAK_ASR: 'fake' },
    timeout: 30_000
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('.shell').waitFor({ state: 'visible', timeout: 5_000 })
  const start = page.getByRole('button', { name: '开始使用' })
  if ((await start.count()) > 0) await start.click()
  return { app, page }
}

async function hideAppWindows(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    electronApp.dock?.hide()
    for (const window of BrowserWindow.getAllWindows()) window.hide()
  })
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

async function recordUtterance(
  app: ElectronApplication,
  page: Page
): Promise<void> {
  const started = waitForCaptureStarted(app)
  started.catch(() => {})
  await page.evaluate(() =>
    (globalThis as unknown as JustSpeakPage).justspeak.toggleRecording()
  )
  await expect(page.locator('.status')).toHaveText('录音中')
  await started
  await page.waitForTimeout(700)
  await page.evaluate(() =>
    (globalThis as unknown as JustSpeakPage).justspeak.toggleRecording()
  )
  await expect(page.locator('.status')).toHaveText('就绪', { timeout: 20_000 })
}

/**
 * The result panel is a singleton window: it is created once and reused, so a
 * plain `waitForEvent('window')` never resolves for a panel that already
 * exists. Wait until a `panel=1` window is both present and visible — an
 * existing but hidden panel must not satisfy this, or "the panel appeared"
 * would stop being tested.
 */
async function waitForPanel(
  app: ElectronApplication,
  timeout = 15_000
): Promise<Page> {
  await expect
    .poll(
      () =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some(
            (window) =>
              window.isVisible() && window.webContents.getURL().includes('panel=1')
          )
        ),
      { timeout }
    )
    .toBe(true)
  const panel = app.windows().find((window) => window.url().includes('panel=1'))
  if (!panel) throw new Error('panel=1 window not found after it became visible')
  return panel
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  assertRealMachineGrants()
  assertTextEditIdle()
})

test('undo removes exactly the recorded grapheme count from TextEdit', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-real-ax-'))
  const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-real-ax-userdata-'))
  const file = path.join(dir, 'document.txt')
  writeFileSync(file, ORIGINAL)
  let app: ElectronApplication | undefined
  try {
    openTextEditDocument(file)
    const launched = await launchApp(userData)
    app = launched.app
    await hideAppWindows(app)
    focusTextEditDocument(file)

    const before = readTextEditDocument(file)
    expect(before).toBe(ORIGINAL)

    await recordUtterance(launched.app, launched.page)
    await expect
      .poll(() => readTextEditDocument(file), { timeout: 15_000 })
      .toContain(TRANSCRIPT)

    const inserted = readTextEditDocument(file)
    const insertedText = inserted.slice(before.length)
    expect(graphemeCount(insertedText)).toBeGreaterThan(0)

    await expect
      .poll(() =>
        launched.page.evaluate(() =>
          (globalThis as unknown as JustSpeakPage).justspeak.getUndoState()
        )
      )
      .toMatchObject({ available: true })

    const undo = await launched.page.evaluate(() =>
      (globalThis as unknown as JustSpeakPage).justspeak.undoLastInjection()
    )
    expect(undo.ok).toBe(true)

    await expect
      .poll(() => readTextEditDocument(file), { timeout: 15_000 })
      .toBe(before)
    expect(graphemeCount(inserted) - graphemeCount(before)).toBe(
      graphemeCount(insertedText)
    )
  } finally {
    if (app) await app.close().catch(() => {})
    closeTextEditDocuments([file])
    quitTextEdit()
    rmSync(userData, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a moved focus is refused and no document loses text', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-real-ax-'))
  const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-real-ax-userdata-'))
  const first = path.join(dir, 'first.txt')
  const second = path.join(dir, 'second.txt')
  writeFileSync(first, ORIGINAL)
  writeFileSync(second, '第二个文档 original')
  let app: ElectronApplication | undefined
  try {
    openTextEditDocument(first)
    const launched = await launchApp(userData)
    app = launched.app
    await hideAppWindows(app)
    focusTextEditDocument(first)

    await recordUtterance(launched.app, launched.page)
    await expect
      .poll(() => readTextEditDocument(first), { timeout: 15_000 })
      .toContain(TRANSCRIPT)
    const firstAfterInsert = readTextEditDocument(first)

    // A second document takes the focus, then the user moves to another app.
    // JustSpeak deliberately reactivates the recorded app before undoing
    // (`src/main/index.ts`, the `activateRunningApp` branch), so the refusal
    // must come from the focused-element identity — hence the title assertion
    // below, which excludes "the app could not even be brought forward".
    openTextEditDocument(second)
    focusTextEditDocument(second)
    const secondBefore = readTextEditDocument(second)
    activateApp('Finder')
    expect(frontmostApp()).toBe('Finder')

    const panelPromise = waitForPanel(launched.app)
    const undo = await launched.page.evaluate(() =>
      (globalThis as unknown as JustSpeakPage).justspeak.undoLastInjection()
    )
    expect(undo.ok).toBe(false)

    // Nothing was deleted anywhere: not the recorded document, not the other one.
    expect(readTextEditDocument(first)).toBe(firstAfterInsert)
    expect(readTextEditDocument(second)).toBe(secondBefore)

    const panel = await panelPromise
    await panel.waitForLoadState('domcontentloaded')
    // Exactly the identity refusal. `已切换目标` (app-changed) would mean the
    // app could not even be brought forward, which is a different failure and
    // must not be accepted as proof of the identity check. If the first real
    // run reports `已切换目标`, record it in docs/REAL-MACHINE-CHECKS.md as a
    // finding — do not widen this assertion.
    await expect(panel.locator('.result-panel-title')).toHaveText('焦点已改变')
    await expect(panel.locator('.result-panel-text')).toHaveValue(firstAfterInsert)
  } finally {
    if (app) await app.close().catch(() => {})
    closeTextEditDocuments([first, second])
    quitTextEdit()
    rmSync(userData, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a quit target is refused, preserved, and never relaunched', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-real-ax-'))
  const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-real-ax-userdata-'))
  const file = path.join(dir, 'document.txt')
  writeFileSync(file, ORIGINAL)
  let app: ElectronApplication | undefined
  try {
    openTextEditDocument(file)
    const launched = await launchApp(userData)
    app = launched.app
    await hideAppWindows(app)
    focusTextEditDocument(file)

    await recordUtterance(launched.app, launched.page)
    await expect
      .poll(() => readTextEditDocument(file), { timeout: 15_000 })
      .toContain(TRANSCRIPT)
    const inserted = readTextEditDocument(file)

    // Closing the document and quitting is what "the target app is gone" means
    // for this check; the guard must not relaunch it.
    closeTextEditDocuments([file])
    quitTextEdit()

    const panelPromise = waitForPanel(launched.app)
    const undo = await launched.page.evaluate(() =>
      (globalThis as unknown as JustSpeakPage).justspeak.undoLastInjection()
    )
    expect(undo.ok).toBe(false)

    const panel = await panelPromise
    await panel.waitForLoadState('domcontentloaded')
    await expect(panel.locator('.result-panel-text')).toHaveValue(inserted)

    const relaunched = spawnSync('pgrep', ['-x', 'TextEdit'], { encoding: 'utf8' })
    expect(String(relaunched.stdout ?? '').trim()).toBe('')
  } finally {
    if (app) await app.close().catch(() => {})
    quitTextEdit()
    rmSync(userData, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
