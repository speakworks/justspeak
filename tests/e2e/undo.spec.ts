import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FAKE_TRANSCRIPT = '你好，这是 JustSpeak 的演示。Hello from JustSpeak.'
const EDITED = '改过的文本 edited text'
const SKIP = process.env.JUSTSPEAK_E2E === '0' || process.env.JUSTSPEAK_E2E === 'false'

interface Harness {
  dir: string
  probeFile: string
  probeDelayFile: string
  deleteModeFile: string
  pasteFailFile: string
  targetFile: string
  logFile: string
}

interface JustSpeakPage {
  justspeak: {
    toggleRecording: () => void
    getHistory: () => Promise<Array<{ id: string; text: string }>>
    getUndoState: () => Promise<{ available: boolean; entryId?: string }>
    undoLastInjection: () => Promise<{ ok: boolean; message?: string }>
  }
}

/**
 * A fake `osascript` that models the three things the correction path does:
 * report a focus target, append the clipboard on ⌘V, and remove the last N
 * grapheme clusters on Backspace. The target buffer is a file, so the assertions
 * observe the text the user would see rather than only the keystroke count.
 */
function makeHarness(): Harness {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-undo-'))
  const probeFile = path.join(dir, 'probe-mode')
  const probeDelayFile = path.join(dir, 'probe-delay')
  const deleteModeFile = path.join(dir, 'delete-mode')
  const pasteFailFile = path.join(dir, 'paste-fail')
  const targetFile = path.join(dir, 'target-buffer')
  const logFile = path.join(dir, 'calls.log')
  writeFileSync(probeFile, 'editable')
  writeFileSync(deleteModeFile, '')
  writeFileSync(pasteFailFile, '')
  writeFileSync(targetFile, '')
  writeFileSync(logFile, '')
  const shim = path.join(dir, 'osascript')
  writeFileSync(
    shim,
    `#!${process.execPath}
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const baseArgs = process.argv.slice(2)
const script = baseArgs[1] || ''
const probeFile = process.env.JUSTSPEAK_E2E_PROBE_FILE
const probeDelayFile = process.env.JUSTSPEAK_E2E_PROBE_DELAY_FILE
const deleteModeFile = process.env.JUSTSPEAK_E2E_DELETE_MODE_FILE
const pasteFailFile = process.env.JUSTSPEAK_E2E_PASTE_FAIL_FILE
const targetFile = process.env.JUSTSPEAK_E2E_TARGET_FILE
const logFile = process.env.JUSTSPEAK_E2E_LOG_FILE
const log = (line) => { try { fs.appendFileSync(logFile, line + '\\n') } catch {} }
const readMode = (file, fallback) => {
  try {
    const value = fs.readFileSync(file, 'utf8').trim()
    return value || fallback
  } catch { return fallback }
}
const probeMode = readMode(probeFile, 'editable')
if (script.includes('key code 51')) {
  const expected = baseArgs.slice(2)
  const count = Number(expected[4])
  const deletionMode = readMode(deleteModeFile, probeMode)
  log('delete-args:' + expected.join('|'))
  if (deletionMode === 'partial') {
    const partialCount = Math.max(1, Math.floor(count / 2))
    const current = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : ''
    const units = Array.from(current)
    fs.writeFileSync(
      targetFile,
      units.slice(0, Math.max(0, units.length - partialCount)).join('')
    )
    log('delete-partial:' + partialCount)
    process.stdout.write('MISMATCH|app-changed-mid-delete\\n')
    process.exit(0)
  }
  const actual = deletionMode === 'other'
    ? { app: 'Notes', bundle: 'com.apple.Notes', role: 'AXTextArea', identity: 'main-editor', editable: true }
    : deletionMode === 'editable'
      ? { app: 'Safari', bundle: 'com.apple.Safari', role: 'AXTextArea', identity: 'main-editor', editable: true }
      : { app: 'Safari', bundle: 'com.apple.Safari', role: 'AXTextArea', identity: 'main-editor', editable: false }
  const mismatch = (reason) => {
    process.stdout.write('MISMATCH|' + reason + '\\n')
    process.exit(0)
  }
  if (expected[0] !== actual.app) mismatch('app-changed')
  if (expected[1] && expected[1] !== actual.bundle) mismatch('bundle-changed')
  if (expected[2] !== actual.role) mismatch('role-changed')
  if (!actual.editable) mismatch('not-editable')
  if (!expected[3] || actual.identity !== expected[3]) mismatch('identity-changed')
  if (!Number.isFinite(count) || count <= 0) {
    process.stdout.write('ERROR|count\\n')
    process.exit(0)
  }
  const current = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : ''
  const units = Array.from(current)
  fs.writeFileSync(targetFile, units.slice(0, Math.max(0, units.length - count)).join(''))
  log('delete:' + count)
  process.stdout.write('OK\\n')
  process.exit(0)
}
if (script.includes('AXFocusedUIElement')) {
  if (fs.existsSync(probeDelayFile)) {
    try { execFileSync('sleep', ['0.15']) } catch {}
  }
  if (probeMode === 'unknown') process.stdout.write('UNKNOWN\\n')
  else if (probeMode === 'noneditable') process.stdout.write('Safari\\ncom.apple.Safari\\nAXTextArea\\n0\\nmain-editor\\n')
  else if (probeMode === 'other') process.stdout.write('Notes\\ncom.apple.Notes\\nAXTextArea\\n1\\nmain-editor\\n')
  else process.stdout.write('Safari\\ncom.apple.Safari\\nAXTextArea\\n1\\nmain-editor\\n')
  process.exit(0)
}
if (script.includes('keystroke "v"')) {
  if (readMode(pasteFailFile, '') === 'fail') process.exit(1)
  let text = ''
  try { text = execFileSync('pbpaste', { encoding: 'utf8' }) } catch { log('pbpaste-failed') }
  fs.appendFileSync(targetFile, text)
  log('paste:' + Array.from(text).length)
  process.exit(0)
}
process.exit(0)
`,
    { mode: 0o755 }
  )
  chmodSync(shim, 0o755)
  return {
    dir,
    probeFile,
    probeDelayFile,
    deleteModeFile,
    pasteFailFile,
    targetFile,
    logFile
  }
}

async function launch(
  userData: string,
  harness: Harness
): Promise<{ app: ElectronApplication; page: Page }> {
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
      JUSTSPEAK_E2E_PROBE_FILE: harness.probeFile,
      JUSTSPEAK_E2E_PROBE_DELAY_FILE: harness.probeDelayFile,
      JUSTSPEAK_E2E_DELETE_MODE_FILE: harness.deleteModeFile,
      JUSTSPEAK_E2E_PASTE_FAIL_FILE: harness.pasteFailFile,
      JUSTSPEAK_E2E_TARGET_FILE: harness.targetFile,
      JUSTSPEAK_E2E_LOG_FILE: harness.logFile,
      PATH: `${harness.dir}:${process.env.PATH ?? ''}`
    },
    timeout: 30_000
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.locator('.shell').waitFor({ state: 'visible', timeout: 5_000 })
    const start = page.getByRole('button', { name: '开始使用' })
    if ((await start.count()) > 0) await start.click()
    return { app, page }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
}

async function hideWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    electronApp.dock?.hide()
    for (const window of BrowserWindow.getAllWindows()) window.hide()
  })
}

async function allWindowsHidden(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().every((window) => !window.isVisible())
  )
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

/** Start one utterance and wait until the capture is actually flowing. */
async function startRecording(app: ElectronApplication, page: Page): Promise<void> {
  const started = waitForCaptureStarted(app)
  started.catch(() => {})
  await page.evaluate(() =>
    (globalThis as unknown as JustSpeakPage).justspeak.toggleRecording()
  )
  await expect(page.locator('.status')).toHaveText('录音中')
  await started
  await page.waitForTimeout(700)
}

/**
 * Stop the utterance. `expectPanel` must be requested here, not before the
 * start: the recording pill is a window too, and an earlier listener would
 * resolve to the pill instead of the result panel.
 */
async function stopRecording(
  app: ElectronApplication,
  page: Page,
  options: { beforeStop?: () => void; expectPanel?: boolean } = {}
): Promise<Page | undefined> {
  const panelPromise = options.expectPanel
    ? app.waitForEvent('window', { timeout: 15_000 })
    : undefined
  options.beforeStop?.()
  await page.evaluate(() =>
    (globalThis as unknown as JustSpeakPage).justspeak.toggleRecording()
  )
  await expect(page.locator('.status')).toHaveText('就绪', { timeout: 15_000 })
  return panelPromise === undefined ? undefined : panelPromise
}

/** Record one utterance; `beforeStop` changes the fake focus before delivery. */
async function dictate(
  app: ElectronApplication,
  page: Page,
  beforeStop?: () => void
): Promise<void> {
  await startRecording(app, page)
  await stopRecording(app, page, { beforeStop })
}

function setProbe(harness: Harness, mode: string): void {
  writeFileSync(harness.probeFile, mode)
}

function targetText(harness: Harness): string {
  return readFileSync(harness.targetFile, 'utf8')
}

function calls(harness: Harness): string[] {
  return readFileSync(harness.logFile, 'utf8').trim().split('\n').filter(Boolean)
}

async function snapshotClipboard(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ clipboard }) => {
    const items: Array<Record<string, unknown>> = []
    for (const item of await clipboard.read()) {
      if (item.types.length === 0) continue
      const data: Record<string, unknown> = {}
      for (const type of item.types) data[type] = await item.getType(type)
      items.push(data)
    }
    const store = globalThis as unknown as {
      __justspeakUndoClipboard?: { items: Array<Record<string, unknown>>; text: string }
    }
    store.__justspeakUndoClipboard = { items, text: await clipboard.readText() }
  })
}

async function restoreClipboard(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const saved = (
      globalThis as unknown as {
        __justspeakUndoClipboard?: { items: Array<Record<string, unknown>>; text: string }
      }
    ).__justspeakUndoClipboard
    if (!saved) return
    try {
      if (saved.items.length > 0) {
        await clipboard.write(saved.items.map((data) => new ClipboardItem(data as never)))
      } else if (saved.text) {
        await clipboard.writeText(saved.text)
      } else {
        clipboard.clear()
      }
    } catch {
      if (saved.text) await clipboard.writeText(saved.text)
      else clipboard.clear()
    }
  })
}

test.describe('JustSpeak correction path', () => {
  test.skip(SKIP, 'JUSTSPEAK_E2E=0 disables the Electron E2E suite')
  test.skip(
    !existsSync(path.join(ROOT, 'out/main/index.js')),
    'run `pnpm build` before the E2E suite'
  )
  test.setTimeout(90_000)

  test('B1: a paste is undone one grapheme at a time and the slot clears', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-undo-userdata-'))
    const harness = makeHarness()
    let app: ElectronApplication | undefined
    try {
      const launched = await launch(userData, harness)
      app = launched.app
      const page = launched.page
      await snapshotClipboard(app)
      await expect(page.locator('.status')).toHaveText('就绪')
      await hideWindow(app)

      setProbe(harness, 'editable')
      await dictate(app, page)
      expect(targetText(harness)).toBe(FAKE_TRANSCRIPT)
      await expect
        .poll(() => page.evaluate(() =>
          (globalThis as unknown as JustSpeakPage).justspeak.getUndoState()
        ))
        .toMatchObject({ available: true })

      const result = await page.evaluate(() =>
        (globalThis as unknown as JustSpeakPage).justspeak.undoLastInjection()
      )
      expect(result.ok).toBe(true)
      // The fake target lost exactly the inserted text, character by character.
      expect(targetText(harness)).toBe('')
      expect(calls(harness)).toContain(`delete:${Array.from(FAKE_TRANSCRIPT).length}`)
      expect(calls(harness)).toContain(
        `delete-args:Safari|com.apple.Safari|AXTextArea|main-editor|${Array.from(FAKE_TRANSCRIPT).length}`
      )
      await expect
        .poll(() => page.evaluate(() =>
          (globalThis as unknown as JustSpeakPage).justspeak.getUndoState()
        ))
        .toMatchObject({ available: false })
    } finally {
      if (app) {
        await restoreClipboard(app).catch(() => {})
        await app.close().catch(() => {})
      }
      rmSync(userData, { recursive: true, force: true })
      rmSync(harness.dir, { recursive: true, force: true })
    }
  })

  test('B1: the atomic script refuses when the target changes after the probe', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-undo-userdata-'))
    const harness = makeHarness()
    let app: ElectronApplication | undefined
    try {
      const launched = await launch(userData, harness)
      app = launched.app
      const page = launched.page
      await snapshotClipboard(app)
      await expect(page.locator('.status')).toHaveText('就绪')
      await hideWindow(app)

      setProbe(harness, 'editable')
      await dictate(app, page)
      await expect
        .poll(() => page.evaluate(() =>
          (globalThis as unknown as JustSpeakPage).justspeak.getUndoState()
        ))
        .toMatchObject({ available: true })

      // The app-level probe still matches; the atomic script sees a different
      // target and must abort without pressing a key.
      writeFileSync(harness.deleteModeFile, 'other')
      const panelPromise = app.waitForEvent('window', { timeout: 15_000 })
      const result = await page.evaluate(() =>
        (globalThis as unknown as JustSpeakPage).justspeak.undoLastInjection()
      )
      expect(result.ok).toBe(false)

      const panel = await panelPromise
      await panel.waitForLoadState('domcontentloaded')
      await expect(panel.locator('.result-panel-title')).toHaveText('撤销未完成')
      await expect(panel.locator('.result-panel-text')).toHaveValue(FAKE_TRANSCRIPT)

      const length = Array.from(FAKE_TRANSCRIPT).length
      expect(calls(harness)).toContain(
        `delete-args:Safari|com.apple.Safari|AXTextArea|main-editor|${length}`
      )
      expect(calls(harness).some((line) => line.startsWith('delete:'))).toBe(false)
      expect(targetText(harness)).toBe(FAKE_TRANSCRIPT)
      // The slot was consumed by the attempt; it is not retried.
      await expect
        .poll(() => page.evaluate(() =>
          (globalThis as unknown as JustSpeakPage).justspeak.getUndoState()
        ))
        .toMatchObject({ available: false })
    } finally {
      if (app) {
        await restoreClipboard(app).catch(() => {})
        await app.close().catch(() => {})
      }
      rmSync(userData, { recursive: true, force: true })
      rmSync(harness.dir, { recursive: true, force: true })
    }
  })

  test('B1: two concurrent undo requests delete exactly once', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-undo-userdata-'))
    const harness = makeHarness()
    let app: ElectronApplication | undefined
    try {
      const launched = await launch(userData, harness)
      app = launched.app
      const page = launched.page
      await snapshotClipboard(app)
      await expect(page.locator('.status')).toHaveText('就绪')
      await hideWindow(app)

      setProbe(harness, 'editable')
      await dictate(app, page)
      await expect
        .poll(() => page.evaluate(() =>
          (globalThis as unknown as JustSpeakPage).justspeak.getUndoState()
        ))
        .toMatchObject({ available: true })

      // Hold both probes open so both callers read the slot before either
      // consumes it; the lock must still allow only one deletion.
      writeFileSync(harness.probeDelayFile, 'delay')
      const results = await page.evaluate(async () => {
        const api = (globalThis as unknown as JustSpeakPage).justspeak
        return Promise.all([api.undoLastInjection(), api.undoLastInjection()])
      })
      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(
        results.some((result) => (result.message ?? '').includes('撤销正在进行'))
      ).toBe(true)
      expect(calls(harness).filter((line) => line.startsWith('delete:'))).toHaveLength(1)
      expect(targetText(harness)).toBe('')
      await expect
        .poll(() => page.evaluate(() =>
          (globalThis as unknown as JustSpeakPage).justspeak.getUndoState()
        ))
        .toMatchObject({ available: false })
    } finally {
      if (app) {
        await restoreClipboard(app).catch(() => {})
        await app.close().catch(() => {})
      }
      rmSync(userData, { recursive: true, force: true })
      rmSync(harness.dir, { recursive: true, force: true })
    }
  })

  test('B1: a partial deletion consumes the slot and is not retried', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-undo-userdata-'))
    const harness = makeHarness()
    let app: ElectronApplication | undefined
    try {
      const launched = await launch(userData, harness)
      app = launched.app
      const page = launched.page
      await snapshotClipboard(app)
      await expect(page.locator('.status')).toHaveText('就绪')
      await hideWindow(app)

      setProbe(harness, 'editable')
      await dictate(app, page)
      await expect
        .poll(() => page.evaluate(() =>
          (globalThis as unknown as JustSpeakPage).justspeak.getUndoState()
        ))
        .toMatchObject({ available: true })

      writeFileSync(harness.deleteModeFile, 'partial')
      const panelPromise = app.waitForEvent('window', { timeout: 15_000 })
      const first = await page.evaluate(() =>
        (globalThis as unknown as JustSpeakPage).justspeak.undoLastInjection()
      )
      expect(first.ok).toBe(false)

      const panel = await panelPromise
      await panel.waitForLoadState('domcontentloaded')
      await expect(panel.locator('.result-panel-title')).toHaveText('撤销可能未完整完成')
      await expect(panel.locator('.result-panel-text')).toHaveValue(FAKE_TRANSCRIPT)

      const remaining = targetText(harness)
      expect(remaining.length).toBeGreaterThan(0)
      expect(remaining.length).toBeLessThan(FAKE_TRANSCRIPT.length)
      const partialCalls = calls(harness).filter((line) =>
        line.startsWith('delete-partial:')
      )
      expect(partialCalls).toHaveLength(1)

      // The slot was consumed by the failed attempt; a second request cannot
      // delete another N characters.
      const second = await page.evaluate(() =>
        (globalThis as unknown as JustSpeakPage).justspeak.undoLastInjection()
      )
      expect(second.ok).toBe(false)
      expect(
        calls(harness).filter((line) => line.startsWith('delete-partial:'))
      ).toHaveLength(1)
      await expect
        .poll(() => page.evaluate(() =>
          (globalThis as unknown as JustSpeakPage).justspeak.getUndoState()
        ))
        .toMatchObject({ available: false })
    } finally {
      if (app) {
        await restoreClipboard(app).catch(() => {})
        await app.close().catch(() => {})
      }
      rmSync(userData, { recursive: true, force: true })
      rmSync(harness.dir, { recursive: true, force: true })
    }
  })

  test('B2: a failed paste after deletion shows the old text as a backup', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-undo-userdata-'))
    const harness = makeHarness()
    let app: ElectronApplication | undefined
    try {
      const launched = await launch(userData, harness)
      app = launched.app
      const page = launched.page
      await snapshotClipboard(app)
      await expect(page.locator('.status')).toHaveText('就绪')
      await hideWindow(app)

      setProbe(harness, 'editable')
      await dictate(app, page)
      await expect
        .poll(() => page.evaluate(() =>
          (globalThis as unknown as JustSpeakPage).justspeak.getUndoState()
        ))
        .toMatchObject({ available: true })
      expect(targetText(harness)).toBe(FAKE_TRANSCRIPT)

      // Start the re-say run, then make the paste keystroke fail.
      await startRecording(app, page)
      writeFileSync(harness.pasteFailFile, 'fail')
      const panelPromise = app.waitForEvent('window', { timeout: 15_000 })
      await page.evaluate(() =>
        (globalThis as unknown as JustSpeakPage).justspeak.toggleRecording()
      )
      await expect(page.locator('.status')).toHaveText('出错了', { timeout: 15_000 })

      const panel = await panelPromise
      await panel.waitForLoadState('domcontentloaded')
      await expect(panel.locator('.result-panel-title')).toHaveText(
        '旧文本已删除，粘贴失败'
      )
      await expect(panel.locator('.result-panel-text')).toHaveValue(FAKE_TRANSCRIPT)
      // The old text was deleted and the new paste never landed.
      expect(targetText(harness)).toBe('')
      expect(calls(harness).filter((line) => line.startsWith('delete:'))).toHaveLength(1)
      await expect
        .poll(() => page.evaluate(() =>
          (globalThis as unknown as JustSpeakPage).justspeak.getUndoState()
        ))
        .toMatchObject({ available: false })
    } finally {
      if (app) {
        await restoreClipboard(app).catch(() => {})
        await app.close().catch(() => {})
      }
      rmSync(userData, { recursive: true, force: true })
      rmSync(harness.dir, { recursive: true, force: true })
    }
  })

  test('B2: a refused re-say inserts only the new text and preserves the old in the panel', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-undo-userdata-'))
    const harness = makeHarness()
    let app: ElectronApplication | undefined
    try {
      const launched = await launch(userData, harness)
      app = launched.app
      const page = launched.page
      await snapshotClipboard(app)
      await expect(page.locator('.status')).toHaveText('就绪')
      await hideWindow(app)

      setProbe(harness, 'editable')
      await dictate(app, page)
      await expect
        .poll(() => page.evaluate(() =>
          (globalThis as unknown as JustSpeakPage).justspeak.getUndoState()
        ))
        .toMatchObject({ available: true })
      expect(targetText(harness)).toBe(FAKE_TRANSCRIPT)

      // The run starts inside the window (re-say candidate), but the target
      // changes before delivery, so the guard must refuse the deletion.
      await startRecording(app, page)
      const panel = await stopRecording(app, page, {
        beforeStop: () => setProbe(harness, 'other'),
        expectPanel: true
      })
      if (panel === undefined) throw new Error('result panel did not open')
      await panel.waitForLoadState('domcontentloaded')

      await expect(panel.locator('.result-panel-title')).toHaveText('旧文本未删除')
      await expect(panel.locator('.result-panel-text')).toHaveValue(FAKE_TRANSCRIPT)
      expect(calls(harness).some((line) => line.startsWith('delete:'))).toBe(false)
      // The refusal left the old text in place and inserted the new text, so
      // the target now holds two utterances — but the user was told and given
      // the old text to copy.
      expect(targetText(harness)).toBe(`${FAKE_TRANSCRIPT}${FAKE_TRANSCRIPT}`)
    } finally {
      if (app) {
        await restoreClipboard(app).catch(() => {})
        await app.close().catch(() => {})
      }
      rmSync(userData, { recursive: true, force: true })
      rmSync(harness.dir, { recursive: true, force: true })
    }
  })

  test('B3: an edited panel reinserts into the same app and rewrites the history row', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-undo-userdata-'))
    const harness = makeHarness()
    let app: ElectronApplication | undefined
    try {
      const launched = await launch(userData, harness)
      app = launched.app
      const page = launched.page
      await snapshotClipboard(app)
      await expect(page.locator('.status')).toHaveText('就绪')
      await hideWindow(app)

      setProbe(harness, 'noneditable')
      await startRecording(app, page)
      const panel = await stopRecording(app, page, { expectPanel: true })
      if (panel === undefined) throw new Error('result panel did not open')
      await panel.waitForLoadState('domcontentloaded')
      await expect(panel.locator('.result-panel-text')).toHaveValue(FAKE_TRANSCRIPT)

      // Wait for the history row link before editing, so the rewrite targets it.
      await expect
        .poll(() => page.evaluate(() =>
          (globalThis as unknown as JustSpeakPage).justspeak.getUndoState()
        ))
        .toMatchObject({ entryId: expect.any(String) })

      await panel.locator('.result-panel-text').fill(EDITED)
      setProbe(harness, 'editable')
      await panel.getByRole('button', { name: '重新插入' }).click()
      // The panel hides before the reinsertion probe/paste runs, so waiting
      // for the window to vanish would race the actual target write.
      await expect.poll(() => targetText(harness), { timeout: 15_000 }).toBe(EDITED)
      await expect.poll(() => allWindowsHidden(app!)).toBe(true)

      expect(targetText(harness)).toBe(EDITED)
      const history = await page.evaluate(() =>
        (globalThis as unknown as JustSpeakPage).justspeak.getHistory()
      )
      expect(history).toHaveLength(1)
      expect(history[0]?.text).toBe(EDITED)
    } finally {
      if (app) {
        await restoreClipboard(app).catch(() => {})
        await app.close().catch(() => {})
      }
      rmSync(userData, { recursive: true, force: true })
      rmSync(harness.dir, { recursive: true, force: true })
    }
  })

  test('B3: a lost focus degrades reinsertion to copy', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'justspeak-undo-userdata-'))
    const harness = makeHarness()
    let app: ElectronApplication | undefined
    try {
      const launched = await launch(userData, harness)
      app = launched.app
      const page = launched.page
      await snapshotClipboard(app)
      await expect(page.locator('.status')).toHaveText('就绪')
      await hideWindow(app)

      setProbe(harness, 'unknown')
      await startRecording(app, page)
      const panel = await stopRecording(app, page, { expectPanel: true })
      if (panel === undefined) throw new Error('result panel did not open')
      await panel.waitForLoadState('domcontentloaded')
      await expect(panel.locator('.result-panel-text')).toHaveValue(FAKE_TRANSCRIPT)

      await panel.locator('.result-panel-text').fill(EDITED)
      await panel.getByRole('button', { name: '重新插入' }).click()

      // No app identity was recorded, so the action must copy, not guess.
      await expect(panel.locator('.result-panel-title')).toHaveText('已复制')
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(EDITED)
      expect(calls(harness).some((line) => line.startsWith('paste:'))).toBe(false)
    } finally {
      if (app) {
        await restoreClipboard(app).catch(() => {})
        await app.close().catch(() => {})
      }
      rmSync(userData, { recursive: true, force: true })
      rmSync(harness.dir, { recursive: true, force: true })
    }
  })
})
