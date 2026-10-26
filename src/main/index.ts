import { app, BrowserWindow, dialog, globalShortcut, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { FakeAsrProvider } from '../core/asr/fake-provider'
import type { AppState, AppStatus, RecordingSummary, TranscriptEvent } from '../shared/ipc'
import { pasteText } from './injection'

let mainWindow: BrowserWindow | null = null
let state: AppState = 'idle'
let lastMessage: string | undefined
let rendererReady = false
let recordingStartedAt = 0
let pipelineRunning = false
let lastStartAt = 0
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
  lastMessage = message
  console.log('[state]', next, message ?? '')
  mainWindow?.webContents.send('state', next, message)
}

function sendTranscript(event: TranscriptEvent): void {
  mainWindow?.webContents.send('transcript', event)
}

async function runPipeline(summary: RecordingSummary): Promise<void> {
  if (pipelineRunning || state !== 'transcribing') {
    console.warn('[pipeline] ignored', { pipelineRunning, state })
    return
  }

  pipelineRunning = true
  console.log('[pipeline] start', summary)
  sendState('transcribing')
  const startedAt = Date.now()

  try {
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
      sendState('error', result.error.message)
      return
    }

    sendTranscript({
      text: result.value.text,
      fake: true,
      durationMs: summary.durationMs,
      latencyMs: Date.now() - startedAt
    })

    sendState('pasting')
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
  console.log('[toggle] state=', state)

  if (state === 'recording') {
    const startedAt = recordingStartedAt
    sendState('transcribing')
    mainWindow?.webContents.send('recording:stop')
    setTimeout(() => {
      if (state === 'transcribing' && !pipelineRunning) {
        console.warn('[pipeline] capture:stopped missing')
        sendState('error', '没有收到录音停止事件，请重试。')
      }
    }, 5000)
    return
  }

  if (state !== 'idle' && state !== 'error') return
  if (!rendererReady) {
    console.warn('[hotkey] ignored: renderer not ready')
    return
  }
  if (now - lastStartAt < 300) return

  lastStartAt = now
  recordingStartedAt = now
  sendState('recording')
  mainWindow?.webContents.send('recording:start')
}

function createWindow(): void {
  const preload = preloadPath()
  if (!existsSync(preload)) {
    dialog.showErrorBox('JustSpeak', `Preload script missing: ${preload}`)
    app.quit()
    return
  }

  mainWindow = new BrowserWindow({
    width: 560,
    height: 480,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    rendererReady = false
  })

  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const allowedPrefix = process.env.ELECTRON_RENDERER_URL ?? 'file://'
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(allowedPrefix)) event.preventDefault()
  })

  mainWindow.webContents.on('preload-error', (_event, preloadFile, error) => {
    console.error('[preload-error]', preloadFile, error)
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
  ipcMain.on('renderer:ready', () => {
    rendererReady = true
    console.log('[renderer] ready')
  })
  ipcMain.on('recording:toggle', () => {
    void toggleRecording()
  })
  ipcMain.on('capture:started', (_event, atMs: number) => {
    console.log('[capture] started', atMs)
  })
  ipcMain.on('capture:stopped', (_event, summary: RecordingSummary) => {
    if (state !== 'transcribing') {
      console.warn('[capture] stale stopped event ignored', state)
      return
    }
    void runPipeline(summary)
  })
  ipcMain.on('capture:failed', (_event, message: string) => {
    if (state === 'recording' || state === 'transcribing') {
      sendState('error', message)
    }
  })
  ipcMain.handle('state:get', (): AppStatus => ({ state, message: lastMessage }))

  createWindow()

  const registered = globalShortcut.register('CommandOrControl+Shift+Space', () => {
    console.log('[hotkey] event')
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
