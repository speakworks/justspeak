import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { FakeAsrProvider } from '../core/asr/fake-provider'
import { Qwen3AsrProvider } from '../core/asr/qwen3-provider'
import type {
  AsrCapabilities,
  AsrModelDescriptor,
  AsrProvider,
  AudioInput,
  ProviderHealth,
  ProviderResult,
  TranscribeOptions,
  TranscriptionResult
} from '../core/asr/types'
import { SessionController } from '../core/session/session-controller'
import type { AppStatus, ModelInfo, TranscriptEvent } from '../shared/ipc'
import { MODEL_CATALOG, PRIMARY_MODEL, PRIMARY_MODEL_DESCRIPTOR } from './asr/catalog'
import { TranscribeCliRunner } from './asr/cli-runner'
import { ModelManager } from './asr/model-manager'
import { parseAsrMode } from './asr/mode'
import { resolveAsrPaths } from './asr/paths'
import { pasteText } from './injection'
import { isTrustedSender } from './ipc-sender'
import { PcmBuffer } from './pcm-buffer'

const MODEL_INFO: ModelInfo = {
  id: PRIMARY_MODEL.id,
  name: PRIMARY_MODEL.name,
  license: PRIMARY_MODEL.license,
  sourceUrl: PRIMARY_MODEL.sourceUrl,
  sizeBytes: PRIMARY_MODEL.sizeBytes,
  quantization: PRIMARY_MODEL.quantization
}

let mainWindow: BrowserWindow | null = null
let rendererReady = false
let session: SessionController | null = null
let providerError: string | undefined
let initializing = false
let pcmBuffer = new PcmBuffer()
let activeModelInfo: ModelInfo | undefined

class UnavailableAsrProvider implements AsrProvider {
  readonly id = 'unavailable'
  readonly capabilities: AsrCapabilities = {
    languages: [],
    streaming: false,
    punctuation: false,
    itn: false,
    timestamps: false,
    vad: false,
    maxAudioMs: 0,
    quantizations: []
  }

  async prepare(_model: AsrModelDescriptor): Promise<void> {}
  async transcribe(
    _input: AudioInput,
    _options: TranscribeOptions
  ): Promise<ProviderResult<TranscriptionResult>> {
    return {
      ok: false,
      error: { code: 'MODEL_LOAD_FAILED', message: providerError ?? 'ASR unavailable', retryable: false }
    }
  }
  async dispose(): Promise<void> {}
  async health(): Promise<ProviderHealth> {
    return { status: 'error', message: providerError ?? 'ASR unavailable' }
  }
}

function preloadPath(): string {
  const base = path.join(app.getAppPath(), 'out/preload')
  for (const file of ['index.cjs', 'index.mjs', 'index.js']) {
    const candidate = path.join(base, file)
    if (existsSync(candidate)) return candidate
  }
  return path.join(base, 'index.cjs')
}

function sendState(next: AppStatus['state'], message?: string): void {
  console.log('[state]', next, message ?? '')
  mainWindow?.webContents.send('state', next, message)
}

function sendTranscript(event: TranscriptEvent): void {
  mainWindow?.webContents.send('transcript', event)
}

function getAudio(): AudioInput {
  const { pcm } = pcmBuffer.finish()
  return {
    pcm,
    sampleRate: 16000,
    channels: 1,
    durationMs: Math.round((pcm.length / 16000) * 1000)
  }
}

function makeSession(provider: AsrProvider, fake: boolean): SessionController {
  return new SessionController({
    provider,
    paste: pasteText,
    sendState,
    sendTranscript,
    fake,
    getAudio,
    transcribeTimeoutMs: 120_000
  })
}

function failSession(message: string): void {
  providerError = message
  session?.fail(message)
}

async function initializeFake(): Promise<void> {
  const provider = new FakeAsrProvider({ delayMs: 350 })
  session = makeSession(provider, true)
  activeModelInfo = undefined
  providerError = undefined
  initializing = false
}

async function initializeProvider(): Promise<void> {
  if (initializing) return
  initializing = true
  providerError = undefined

  const mode = parseAsrMode(process.env.JUSTSPEAK_ASR)
  if (!mode.ok) {
    session = makeSession(new UnavailableAsrProvider(), false)
    activeModelInfo = undefined
    initializing = false
    failSession(mode.message)
    return
  }
  if (mode.mode === 'fake') {
    await initializeFake()
    return
  }

  const paths = resolveAsrPaths(app.getAppPath(), MODEL_CATALOG)
  const runner = new TranscribeCliRunner({
    cliPath: paths.cliPath,
    modelPath: paths.modelPath
  })
  const provider = new Qwen3AsrProvider({
    model: PRIMARY_MODEL_DESCRIPTOR,
    runner
  })
  session = makeSession(provider, false)
  activeModelInfo = MODEL_INFO

  if (!existsSync(paths.cliPath)) {
    initializing = false
    failSession(
      `Qwen3 运行时缺失：${paths.cliPath}。请运行 pnpm setup:asr（运行时来源：${MODEL_CATALOG.runtimes[0]?.sourceUrl}）。`
    )
    return
  }

  if (!existsSync(paths.modelPath)) {
    sendState('idle', '首次使用：正在下载 Qwen3-ASR 0.6B（约 850 MB）…')
    let lastPercent = 0
    try {
      const fetchImpl = ((input: string | URL | Request, init?: RequestInit) =>
        net.fetch(input as string, init)) as typeof fetch
      const manager = new ModelManager({ fetch: fetchImpl })
      const file = PRIMARY_MODEL.files[0]
      if (!file) throw new Error('model catalog has no file')
      await manager.download(file, paths.modelPath, {
        onProgress: ({ bytes, totalBytes }) => {
          const percent = Math.floor((bytes / totalBytes) * 100)
          if (percent >= lastPercent + 5) {
            lastPercent = percent
            sendState('idle', `首次使用：正在下载 ${PRIMARY_MODEL.name}（${percent}%）…`)
          }
        }
      })
    } catch (error) {
      initializing = false
      failSession(
        `模型下载失败：${error instanceof Error ? error.message : String(error)}。` +
          `来源：${PRIMARY_MODEL.sourceUrl}；许可证：${PRIMARY_MODEL.license}。` +
          '可运行 pnpm setup:asr 手动准备模型。'
      )
      return
    }
  }

  try {
    await provider.prepare(PRIMARY_MODEL_DESCRIPTOR)
    initializing = false
    sendState('idle', `模型就绪：${PRIMARY_MODEL.name} · ${PRIMARY_MODEL.license}`)
  } catch (error) {
    initializing = false
    failSession(
      `Qwen3 模型加载失败：${error instanceof Error ? error.message : String(error)}。` +
        `来源：${PRIMARY_MODEL.sourceUrl}；许可证：${PRIMARY_MODEL.license}。`
    )
  }
}

function toggleRecording(): void {
  if (!session) {
    sendState('error', '语音识别仍在初始化，请稍候。')
    return
  }
  if (providerError) {
    // Re-run initialization so a repaired install can recover without a restart.
    void initializeProvider()
    return
  }
  if (initializing) {
    sendState('idle', '正在准备语音识别，请稍候…')
    return
  }

  const action = session.toggle(rendererReady)
  if (action === 'start') {
    pcmBuffer.begin()
    mainWindow?.webContents.send('recording:start')
    return
  }
  if (action === 'stop') {
    mainWindow?.webContents.send('recording:stop')
    setTimeout(() => session?.handleStopWatchdog(), 5000)
  }
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
  const allowedPrefix =
    process.env.ELECTRON_RENDERER_URL ??
    pathToFileURL(path.join(app.getAppPath(), 'out/renderer')).href
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(allowedPrefix)) event.preventDefault()
  })

  mainWindow.webContents.on('preload-error', (_event, preloadFile, error) => {
    console.error('[preload-error]', preloadFile, error)
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    rendererReady = false
    const message = `界面加载失败：${description} (${code}) ${url}`
    session?.fail(message)
    dialog.showErrorBox('JustSpeak', message)
    app.quit()
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererReady = false
    const message = `界面进程异常退出：${details.reason}`
    session?.fail(message)
    dialog.showErrorBox('JustSpeak', `${message}。请重启应用。`)
    app.quit()
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
    toggleRecording()
  })
  ipcMain.on('capture:started', (_event, atMs: number) => {
    console.log('[capture] started', atMs)
    session?.handleCaptureStarted(atMs)
  })
  ipcMain.on('capture:stopped', (_event, summary: unknown) => {
    void session?.handleCaptureStopped(summary)
  })
  ipcMain.on('capture:failed', (_event, message: unknown) => {
    pcmBuffer.finish()
    session?.handleCaptureFailed(message)
  })
  ipcMain.on('capture:pcm', (event, payload: unknown) => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      console.warn('[capture:pcm] rejected untrusted sender')
      return
    }
    const result = pcmBuffer.append(payload)
    if (result.ok || result.error.code === 'NOT_RECORDING') return
    mainWindow?.webContents.send('recording:stop')
    session?.handleCaptureFailed(result.error.message)
  })
  ipcMain.handle('state:get', (): AppStatus => ({
    state: session?.state ?? 'idle',
    message: session?.lastMessage,
    modelInfo: activeModelInfo
  }))

  createWindow()
  void initializeProvider()

  const registered = globalShortcut.register('CommandOrControl+Shift+Space', () => {
    console.log('[hotkey] event')
    toggleRecording()
  })
  if (!registered) {
    session?.fail('无法注册 Command+Shift+Space，可能已被其他应用占用。')
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  app.quit()
})
