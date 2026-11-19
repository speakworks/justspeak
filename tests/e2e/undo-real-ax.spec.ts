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
 *   - Automation consent for System Events on first use.
 *
 * When a prerequisite is missing the spec FAILS with the reason printed. It
 * never downgrades to a skip: see
 * `openspec/specs/real-machine-verification/spec.md`.
 *
 * Safety: only a temporary document in a fresh directory is touched, and
 * TextEdit is quit again in `finally` — but only if this spec started it.
 */
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  activateApp,
  assertRealMachineGrants,
  closeTextEdit,
  focusTextEditCaretAtEnd,
  frontmostApp,
  graphemeCount,
  openTextEditDocument,
  quitTextEditIfRunning,
  readTextEditDocument,
  readTextEditDocumentNamed
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
 * The result panel is a singleton window: it is created once and reused. A
 * plain `waitForEvent('window')` therefore misses a panel that already exists,
 * so look at the live windows first.
 */
async function waitForPanel(
  app: ElectronApplication,
  timeout = 15_000
): Promise<Page> {
  const existing = app.windows().find((win) => win.url().includes('panel=1'))
  if (existing) return existing
  return app.waitForEvent('window', {
    predicate: (win) => win.url().includes('panel=1'),
    timeout
  })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  assertRealMachineGrants()
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
    focusTextEditCaretAtEnd()

    const before = readTextEditDocument()
    expect(before).toBe(ORIGINAL)

    await recordUtterance(launched.app, launched.page)
    await expect.poll(() => readTextEditDocument(), { timeout: 15_000 }).toContain(
      TRANSCRIPT
    )

    const inserted = readTextEditDocument()
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

    await expect.poll(() => readTextEditDocument(), { timeout: 15_000 }).toBe(before)
    expect(graphemeCount(inserted) - graphemeCount(before)).toBe(
      graphemeCount(insertedText)
    )
  } finally {
    if (app) await app.close().catch(() => {})
    quitTextEditIfRunning()
    rmSync(userData, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a moved focus is refused and no other window loses text', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-real-ax-'))
  const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-real-ax-userdata-'))
  const first = path.join(dir, 'first.txt')
  const second = path.join(dir, 'second.txt')
  const FIRST_NAME = 'first.txt'
  const SECOND_NAME = 'second.txt'
  writeFileSync(first, ORIGINAL)
  writeFileSync(second, '第二个文档 original')
  let app: ElectronApplication | undefined
  try {
    openTextEditDocument(first)
    const launched = await launchApp(userData)
    app = launched.app
    await hideAppWindows(app)
    focusTextEditCaretAtEnd()

    await recordUtterance(launched.app, launched.page)
    await expect
      .poll(() => readTextEditDocumentNamed(FIRST_NAME), { timeout: 15_000 })
      .toContain(TRANSCRIPT)
    const firstAfterInsert = readTextEditDocumentNamed(FIRST_NAME)

    // A second document takes the focus, then the user moves to another app.
    // JustSpeak deliberately reactivates the recorded app before undoing
    // (`src/main/index.ts`, the `activateRunningApp` branch), so the refusal
    // here must come from the focused-element identity, not from the app name.
    openTextEditDocument(second)
    focusTextEditCaretAtEnd(SECOND_NAME)
    const secondBefore = readTextEditDocumentNamed(SECOND_NAME)
    activateApp('Finder')
    expect(frontmostApp()).toBe('Finder')

    const panelPromise = waitForPanel(launched.app)
    const undo = await launched.page.evaluate(() =>
      (globalThis as unknown as JustSpeakPage).justspeak.undoLastInjection()
    )
    expect(undo.ok).toBe(false)

    // Nothing was deleted anywhere: not the recorded document, not the other one.
    expect(readTextEditDocumentNamed(FIRST_NAME)).toBe(firstAfterInsert)
    expect(readTextEditDocumentNamed(SECOND_NAME)).toBe(secondBefore)

    const panel = await panelPromise
    await panel.waitForLoadState('domcontentloaded')
    await expect(panel.locator('.result-panel-text')).toHaveValue(firstAfterInsert)
  } finally {
    if (app) await app.close().catch(() => {})
    closeTextEdit()
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
    focusTextEditCaretAtEnd()

    await recordUtterance(launched.app, launched.page)
    await expect.poll(() => readTextEditDocument(1), { timeout: 15_000 }).toContain(
      TRANSCRIPT
    )
    const inserted = readTextEditDocument(1)

    closeTextEdit()

    const panelPromise = waitForPanel(launched.app)
    const undo = await launched.page.evaluate(() =>
      (globalThis as unknown as JustSpeakPage).justspeak.undoLastInjection()
    )
    expect(undo.ok).toBe(false)

    const panel = await panelPromise
    await panel.waitForLoadState('domcontentloaded')
    await expect(panel.locator('.result-panel-text')).toHaveValue(inserted)

    // A closed target is never launched as a side effect of pressing undo.
    const relaunched = spawnSync('pgrep', ['-x', 'TextEdit'], { encoding: 'utf8' })
    expect(String(relaunched.stdout ?? '').trim()).toBe('')
  } finally {
    if (app) await app.close().catch(() => {})
    quitTextEditIfRunning()
    rmSync(userData, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
