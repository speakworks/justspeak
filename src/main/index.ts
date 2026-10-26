import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { FakeAsrProvider } from '../core/asr/fake-provider'
import type { AppState, RecordingSummary, TranscriptEvent } from '../shared/ipc'
import { pasteText } from './injection'

let mainWindow: BrowserWindow | null = null
let state: AppState = 'idle'
let recordingStartedAt = 0
let pipelineRunning = false
let lastToggleAt = 0
const asr = new FakeAsrProvider()

function preloadPath(): string {
  const base = path.join(app.getAppPath(), 'out/preload')
  for (const file of ['index.cjs', 'index.mjs', 'index.js']) {
    const candidate = path.join(base, file)
    if (existsSync(candidate)) return candidate
  }
  return path.join(base, 'index.cjs')
}

function sendState(next: AppState, message?: string): void {
  state = next
  console.log('[state]', next, message ?? '')
  mainWindow?.webContents.send('state', next, message)
}

function sendTranscript(event: TranscriptEvent): void {
  mainWindow?.webContents.send('transcript', event)
}

async function runPipeline(summary: RecordingSummary): Promise<void> {
  if (pipelineRunning) {
    console.warn('[pipeline] already running; ignore duplicate stop')
    return
  }
  pipelineRunning = true
  console.log('[pipeline] start', summary)
  sendState('transcribing')
  const startedAt = Date.now()
  const result = await asr.transcribe(
    {
      pcm: new Int16Array(),
      sampleRate: 16000,
      channels: 1,
      durationMs: summary.durationMs
    },
    {}
  )

  if (!result.ok) {
    pipelineRunning = false
    sendState('error', result.error.message)
    return
  }

  const event: TranscriptEvent = {
    text: result.value.text,
    fake: true,
    durationMs: summary.durationMs,
    latencyMs: Date.now() - startedAt
  }
  sendTranscript(event)

  sendState('pasting')
  try {
    await pasteText(result.value.text)
    sendState('idle')
  } catch (error) {
    sendState('error', error instanceof Error ? error.message : String(error))
  } finally {
    pipelineRunning = false
  }
}

async function toggleRecording(): Promise<void> {
  const now = Date.now()
  if (now - lastToggleAt < 300) return
  lastToggleAt = now

  if (state === 'recording') {
    const startedAt = recordingStartedAt
    sendState('transcribing')
    mainWindow?.webContents.send('recording:stop')
    setTimeout(() => {
      if (state === 'transcribing' && !pipelineRunning) {
        console.warn('[pipeline] capture:stopped missing; using fallback summary')
        void runPipeline({
          durationMs: Date.now() - startedAt,
          frames: 0,
          sampleRate: 16000,
          rms: 0
        })
      }
    }, 5000)
    return
  }

  if (state !== 'idle' && state !== 'error') return

  recordingStartedAt = Date.now()
  sendState('recording')
  mainWindow?.webContents.send('recording:start')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 560,
    height: 480,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.on('preload-error', (_event, preload, error) => {
    console.error('[preload-error]', preload, error)
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('[did-fail-load]', code, description, url)
  })
  if (process.env.JUSTSPEAK_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), 'out/renderer/index.html'))
  }
}

app.whenReady().then(() => {
  ipcMain.on('recording:toggle', () => {
    void toggleRecording()
  })
  ipcMain.on('capture:started', () => {})
  ipcMain.on('capture:stopped', (_event, summary: RecordingSummary) => {
    void runPipeline(summary)
  })
  ipcMain.on('capture:failed', (_event, message: string) => {
    sendState('error', message)
  })
  ipcMain.handle('state:get', () => state)

  createWindow()

  const registered = globalShortcut.register('CommandOrControl+Shift+Space', () => {
    void toggleRecording()
  })
  if (!registered) {
    sendState('error', '无法注册 Command+Shift+Space，可能已被其他应用占用。')
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  app.quit()
})
