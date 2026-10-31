import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  net,
  screen
} from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { QWEN3_CAPABILITIES } from '../core/asr/qwen3-provider'
import { SENSEVOICE_CAPABILITIES } from '../core/asr/sensevoice-provider'
import type { SegmenterOptions } from '../core/audio/segmenter'
import { createTranscriptionProvider } from '../core/audio/segmented-provider'
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
import type { ModelCatalogEntry } from '../core/asr/model-catalog'
import { DEFAULT_ACCELERATOR, parseAccelerator } from '../core/hotkey/accelerator'
import { registerHotkeyWithFallback } from '../core/hotkey/registration'
import type { HotkeySource } from '../core/hotkey/types'
import { postprocess, type PostprocessOptions } from '../core/postprocess'
import { SessionController } from '../core/session/session-controller'
import { consumePendingNotice } from '../core/session/state-notice'
import { planPreferenceSet } from '../core/preferences/merge'
import { summarizeProvider } from '../core/preferences/view'
import { resolveModelsDir } from './asr/paths'
import { createLevelThrottle, rmsOf } from '../core/overlay/level'
import {
  destroyOverlay,
  hideOverlay,
  initOverlay,
  overlayWebContentsId,
  replayOverlay,
  showOverlay,
  updateOverlayLevel,
  type OverlayPayload
} from './overlay'
import type {
  AppStatus,
  AsrProviderSelection,
  HotkeySetResult,
  ModelInfo,
  ProviderOption,
  PreferencesSetResult,
  PreferencesView,
  ProviderSummary,
  ResolvedTheme,
  SelectableAsrProviderId,
  ThemePreference,
  TranscriptEvent,
  VocabularySummary
} from '../shared/ipc'
import { MODEL_CATALOG } from './asr/catalog'
import { ModelManager } from './asr/model-manager'
import {
  DEFAULT_ASR_MODE,
  isSelectableAsrMode,
  resolveAsrMode,
  type AsrMode
} from './asr/mode'
import { ProviderPreferenceStore } from './asr/provider-preference'
import { buildProvider } from './asr/providers'
import { downloadFailureHint, runtimeMissingHint } from './asr/download-hint'
import {
  parseSegmentationConfig,
  type SegmentationMode
} from './asr/segmentation-mode'
import { ElectronGlobalShortcutSource } from './hotkey-source'
import { pasteText } from './injection'
import { isTrustedSender } from './ipc-sender'
import { PcmBuffer } from './pcm-buffer'
import { ThemeStore } from './theme-store'
import { VocabularyStore, type VocabularyLoadResult } from './vocabulary-store'

const DARK_BACKGROUND = '#0b0f14'
const LIGHT_BACKGROUND = '#f6f5f2'

const PROVIDER_OPTIONS: Record<SelectableAsrProviderId, ProviderOption> = {
  qwen3: { id: 'qwen3', label: 'Qwen3-ASR 0.6B', capabilities: QWEN3_CAPABILITIES },
  sensevoice: { id: 'sensevoice', label: 'SenseVoice Small', capabilities: SENSEVOICE_CAPABILITIES }
}

let mainWindow: BrowserWindow | null = null
let rendererReady = false
let session: SessionController | null = null
let sessionMode: AsrMode = DEFAULT_ASR_MODE
let activeProvider: AsrProvider | null = null
let providerError: string | undefined
let initializing = false
let pcmBuffer = new PcmBuffer()
let activeModelInfo: ModelInfo | undefined
let themePreference: ThemePreference = 'system'
let themeStore: ThemeStore
let vocabularyStore: VocabularyStore
let hotkeySource: HotkeySource | undefined
let activeHotkey = DEFAULT_ACCELERATOR
let hotkeyNotice: string | undefined
let postprocessOptions: PostprocessOptions = {}
let providerPreference: ProviderPreferenceStore
/** Raw persisted value; validation happens in `resolveAsrMode`. */
let preferredProvider: string | undefined
let segmentationMode: SegmentationMode = 'single'
let segmenterOptions: SegmenterOptions | undefined
/**
 * A partial segmented transcript is returned as provider success (the frozen
 * provider contract cannot carry text and an error together). Main attaches
 * the typed failure message to the next idle event so the user still learns
 * which segment was lost.
 */
let pendingSegmentFailure: string | undefined

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
  const notice = consumePendingNotice(next, message, pendingSegmentFailure)
  message = notice.message
  pendingSegmentFailure = notice.pending
  console.log('[state]', next, message ?? '')
  mainWindow?.webContents.send('state', next, message)
  const overlay = overlayFor(next)
  if (overlay) showOverlay(overlay)
  else hideOverlay()
}

function sendTranscript(event: TranscriptEvent): void {
  mainWindow?.webContents.send('transcript', event)
}

/**
 * Keep the native window chrome (traffic lights, titlebar) in step with the
 * renderer.
 *
 * `themeSource` must carry the *preference*, not the resolved value: Electron
 * overrides `shouldUseDarkColors` with whatever is written there, so writing a
 * resolved `'light'`/`'dark'` destroys the OS reading and makes `'system'`
 * permanently stick to the last pinned choice. Verified against Electron:
 * with the OS light, setting `themeSource='dark'` makes `shouldUseDarkColors`
 * true and `themeSource='system'` is the only way to read the OS again.
 */
function applyTheme(): void {
  nativeTheme.themeSource = themePreference
  // After the assignment above, this reflects the preference when pinned and
  // the real OS appearance when `system`.
  const resolved = effectiveTheme()
  mainWindow?.setBackgroundColor(resolved === 'light' ? LIGHT_BACKGROUND : DARK_BACKGROUND)
  console.log('[theme]', themePreference, '->', resolved)
}

function effectiveTheme(): ResolvedTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

/**
 * The panel's provider row, derived from what is actually running. `sessionMode`
 * keeps its value through every failure path (missing model, bad env, invalid
 * segmentation), so liveness is what decides whether a switch is on offer.
 */
function describeProvider(): ProviderSummary {
  const option =
    sessionMode in PROVIDER_OPTIONS
      ? PROVIDER_OPTIONS[sessionMode as SelectableAsrProviderId]
      : undefined
  return summarizeProvider({
    mode: sessionMode,
    live: activeProvider !== null && providerError === undefined && !initializing,
    label: option?.label
  })
}

function summarizeVocabulary(result: VocabularyLoadResult): VocabularySummary {
  return {
    path: vocabularyStore.file,
    state: result.state,
    replaceCount: result.options.vocabulary?.replace?.length ?? 0,
    protectCount: result.options.vocabulary?.protect?.length ?? 0,
    ...(result.message === undefined ? {} : { message: result.message })
  }
}

/**
 * The one read path for the settings panel. Theme comes from disk (so a
 * hand-edited file is honoured); the hotkey is the accelerator actually live;
 * the vocabulary file is re-read so this call doubles as "reload".
 */
async function readPreferencesView(): Promise<PreferencesView> {
  const stored = await themeStore.loadPreferences()
  if (stored.theme !== themePreference) {
    themePreference = stored.theme
    applyTheme()
  }
  const vocabulary = await vocabularyStore.loadDetailed()
  postprocessOptions = vocabulary.options
  return {
    theme: themePreference,
    hotkey: activeHotkey,
    hotkeyMessage: hotkeyNotice,
    vocabulary: summarizeVocabulary(vocabulary),
    provider: describeProvider()
  }
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
  // The default mode returns the inner provider untouched, so this wiring has
  // no effect on the one-shot path.
  const selected = createTranscriptionProvider(provider, segmentationMode, {
    segmenter: segmenterOptions,
    onPartialFailure: (error) => {
      pendingSegmentFailure = error.message
      console.warn('[segment]', error.message)
    }
  })
  return new SessionController({
    provider: selected,
    paste: pasteText,
    sendState,
    sendTranscript,
    fake,
    // The stage sits between the provider result and paste, so the fake and
    // the local provider both go through it.
    postprocess: (text) => postprocess(text, postprocessOptions),
    getAudio,
    transcribeTimeoutMs: 120_000
  })
}

function failSession(message: string): void {
  providerError = message
  session?.fail(message)
}


function modelInfoFor(entry: ModelCatalogEntry, provider: AsrProvider): ModelInfo {
  return {
    id: entry.id,
    name: entry.name,
    license: entry.license,
    sourceUrl: entry.sourceUrl,
    sizeBytes: entry.sizeBytes,
    quantization: entry.quantization,
    // The UI renders what the provider declares, never a provider-id lookup.
    capabilities: provider.capabilities
  }
}

function asrSelection(): AsrProviderSelection | undefined {
  if (sessionMode === 'fake') return undefined
  return { id: sessionMode, options: Object.values(PROVIDER_OPTIONS) }
}

function currentStatus(): AppStatus {
  return {
    state: session?.state ?? 'idle',
    message: session?.lastMessage,
    modelInfo: activeModelInfo,
    asr: asrSelection()
  }
}

function pipelineBusy(): boolean {
  return (
    session?.state === 'recording' ||
    session?.state === 'transcribing' ||
    session?.state === 'pasting'
  )
}

async function disposeActiveProvider(): Promise<void> {
  const provider = activeProvider
  activeProvider = null
  if (provider) {
    try {
      await provider.dispose()
    } catch (error) {
      console.warn('[asr] provider dispose failed', error)
    }
  }
}

async function initializeProvider(): Promise<void> {
  if (initializing) return
  initializing = true
  providerError = undefined
  activeModelInfo = undefined
  pendingSegmentFailure = undefined


  const selection = resolveAsrMode({
    env: process.env.JUSTSPEAK_ASR,
    preference: preferredProvider
  })
  if (!selection.ok) {
    await disposeActiveProvider()
    session = makeSession(new UnavailableAsrProvider(), false)
    initializing = false
    failSession(selection.message)
    return
  }


  // Experimental segmentation knobs fail closed: an invalid value must not
  // silently fall back to the single-shot path, or the user would believe
  // segmentation ran when it did not.
  const segmentation = parseSegmentationConfig(process.env)
  if (!segmentation.ok) {
    await disposeActiveProvider()
    session = makeSession(new UnavailableAsrProvider(), false)
    initializing = false
    failSession(segmentation.message)
    return
  }
  segmentationMode = segmentation.config.mode
  segmenterOptions = segmentation.config.segmenter

  const appRoot = app.getAppPath()
  const built = buildProvider({
    mode: selection.mode,
    appRoot,
    // Packaged: appRoot points inside the read-only app.asar, so the runtime and
    // weights live in userData instead (see resolveModelsDir).
    modelsDir: resolveModelsDir({
      appRoot,
      userDataDir: app.getPath('userData'),
      packaged: app.isPackaged
    }),
    catalog: MODEL_CATALOG
  })
  if (!built.ok) {
    await disposeActiveProvider()
    session = makeSession(new UnavailableAsrProvider(), false)
    initializing = false
    failSession(built.message)
    return
  }

  sessionMode = built.mode
  await disposeActiveProvider()

  if (built.mode === 'fake') {
    activeProvider = built.provider
    session = makeSession(built.provider, true)
    initializing = false
    sendState('idle', 'FAKE ASR（测试模式）')
    return
  }

  const { mode, model, descriptor, paths, provider } = built

  if (!existsSync(paths.cliPath)) {
    session = makeSession(new UnavailableAsrProvider(), false)
    initializing = false
    failSession(
      `${model.name} 运行时缺失：${paths.cliPath}。` +
        runtimeMissingHint({
          packaged: app.isPackaged,
          cliPath: paths.cliPath,
          sourceUrl: MODEL_CATALOG.runtimes[0]?.sourceUrl
        })
    )
    return
  }

  if (!existsSync(paths.modelPath)) {
    sendState(
      'idle',
      `首次使用：正在下载 ${model.name}（约 ${Math.round(model.sizeBytes / 1e6)} MB）…`
    )
    let lastPercent = 0
    try {
      const fetchImpl = ((input: string | URL | Request, init?: RequestInit) =>
        net.fetch(input as string, init)) as typeof fetch
      const manager = new ModelManager({ fetch: fetchImpl })
      const file = model.files[0]
      if (!file) throw new Error('model catalog has no file')
      await manager.download(file, paths.modelPath, {
        onProgress: ({ bytes, totalBytes }) => {
          const percent = Math.floor((bytes / totalBytes) * 100)
          if (percent >= lastPercent + 5) {
            lastPercent = percent
            sendState('idle', `首次使用：正在下载 ${model.name}（${percent}%）…`)
          }
        }
      })
    } catch (error) {
      session = makeSession(new UnavailableAsrProvider(), false)
      initializing = false
      failSession(
        `模型下载失败：${error instanceof Error ? error.message : String(error)}。` +
          `来源：${model.sourceUrl}；许可证：${model.license}。` +
          downloadFailureHint(mode, model.name, paths.modelPath)
      )
      return
    }
  }

  const file = model.files[0]
  if (!file) {
    session = makeSession(new UnavailableAsrProvider(), false)
    initializing = false
    failSession('模型目录条目缺失，请运行 pnpm setup:asr。')
    return
  }
  console.log(`[model] verifying ${model.id} SHA-256 before use…`)
  let verification: Awaited<ReturnType<ModelManager['verify']>>
  try {
    verification = await new ModelManager().verify(paths.modelPath, file)
  } catch (error) {
    // A stat/read failure must not leave `initializing` stuck at true: the hotkey
    // would keep answering "正在准备语音识别" with no error and no retry path.
    session = makeSession(new UnavailableAsrProvider(), false)
    initializing = false
    failSession(
      `模型校验失败：${error instanceof Error ? error.message : String(error)}。` +
        `请重新下载；来源：${model.sourceUrl}；许可证：${model.license}。`
    )
    return
  }
  if (!verification.ok) {
    session = makeSession(new UnavailableAsrProvider(), false)
    initializing = false
    failSession(
      `模型校验失败（期望 ${file.sha256}，实际 ${verification.sha256}）。` +
        `请重新下载；来源：${model.sourceUrl}；许可证：${model.license}。`
    )
    return
  }
  console.log('[model] verified', verification.sha256)

  try {
    await provider.prepare(descriptor)
    activeProvider = provider
    activeModelInfo = modelInfoFor(model, provider)
    session = makeSession(provider, false)
    initializing = false
    sendState('idle', `模型就绪：${model.name} · ${model.license}`)
  } catch (error) {
    session = makeSession(new UnavailableAsrProvider(), false)
    initializing = false
    failSession(
      `${model.name} 模型加载失败：${error instanceof Error ? error.message : String(error)}。` +
        `来源：${model.sourceUrl}；许可证：${model.license}。`
    )
  }
}

/** Push the panel's single copy after a state that changes what it shows. */
async function postPreferences(): Promise<void> {
  mainWindow?.webContents.send('preferences:changed', await readPreferencesView())
}

/**
 * `initializeProvider` flips `initializing` back to false on every exit, which
 * changes whether the provider row may offer a switch. The panel keeps one
 * renderer copy, so that copy has to be told; otherwise it stays on whatever
 * it read mid-initialization and reports the provider as unavailable for good.
 */
async function runProviderInitialization(): Promise<void> {
  try {
    await initializeProvider()
  } finally {
    await postPreferences().catch((error: unknown) => {
      console.warn('[preferences] broadcast after initialisation failed', error)
    })
  }
}

async function switchAsrProvider(value: unknown): Promise<AppStatus> {
  if (!isSelectableAsrMode(value)) {
    sendState(session?.state ?? 'idle', `不支持的 ASR 提供方：${String(value)}。`)
    return currentStatus()
  }
  if (initializing) return currentStatus()
  if (pipelineBusy()) {
    sendState(session?.state ?? 'idle', '请先停止当前录音再切换识别模型。')
    return currentStatus()
  }
  if (sessionMode === value) return currentStatus()

  try {
    await providerPreference.save(value)
  } catch (error) {
    console.warn('[asr] failed to persist provider preference', error)
  }
  preferredProvider = value
  await runProviderInitialization()
  return currentStatus()
}

function toggleRecording(): void {
  if (!session) {
    sendState('error', '语音识别仍在初始化，请稍候。')
    return
  }
  if (providerError) {
    // Re-run initialization so a repaired install can recover without a restart.
    void runProviderInitialization()
    return
  }
  if (initializing) {
    sendState('idle', '正在准备语音识别，请稍候…')
    return
  }

  const action = session.toggle(rendererReady)
  if (action === 'start') {
    pendingSegmentFailure = undefined
    pcmBuffer.begin()
    mainWindow?.webContents.send('recording:start')
    return
  }
  if (action === 'stop') {
    mainWindow?.webContents.send('recording:stop')
    setTimeout(() => session?.handleStopWatchdog(), 5000)
  }
}

/**
 * Which pill state a session state maps to, or null when the pill should go.
 * The theme travels with the state so the pill never has to ask for preferences
 * (those handlers are gated to the main window).
 */
function overlayFor(next: AppStatus['state']): OverlayPayload | null {
  if (next === 'recording') return { state: 'recording', theme: effectiveTheme() }
  if (next === 'transcribing' || next === 'pasting') {
    return { state: 'working', theme: effectiveTheme() }
  }
  return null
}

const levelThrottle = createLevelThrottle()

/** RMS of an incoming PCM batch, or null when the payload is not one. */
function levelOf(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  const samples = (payload as { samples?: unknown }).samples
  return samples instanceof Int16Array ? rmsOf(samples) : null
}

function pushOverlayState(): void {
  replayOverlay()
}

/** The pill's ✕: discard the capture and return to idle. */
function cancelRecording(): void {
  if (!session) return
  if (session.cancel() !== 'cancel') return
  pcmBuffer.finish()
  mainWindow?.webContents.send('recording:stop')
}

/** The pill's ✓: only meaningful while capturing; a toggle from idle would start one. */
function finishRecording(): void {
  if (!session || session.state !== 'recording') return
  toggleRecording()
}

function createWindow(): void {
  const preload = preloadPath()
  if (!existsSync(preload)) {
    dialog.showErrorBox('JustSpeak', `Preload script missing: ${preload}`)
    app.quit()
    return
  }

  // Height is measured in the real qwen3 mode: the model line only renders
  // there, so measuring in fake mode under-counts and lets the page scroll.
  // The transcript card has a fixed height, so empty, one-line, long
  // transcript and long-error states all measure the same 632 CSS px. The
  // hotkey editor's error message adds at most one line, which the reduced
  // app bottom padding absorbs; 640 still leaves a margin. Shrink only,
  // never grow, on a smaller display.
  const PREFERRED_WIDTH = 720
  const PREFERRED_HEIGHT = 640
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(PREFERRED_WIDTH, workArea.width - 40)
  const height = Math.min(PREFERRED_HEIGHT, workArea.height - 40)

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(560, width),
    minHeight: Math.min(560, height),
    show: false,
    titleBarStyle: 'hiddenInset',
    // A saved `light` preference must not flash a dark frame before paint.
    backgroundColor: effectiveTheme() === 'light' ? LIGHT_BACKGROUND : DARK_BACKGROUND,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    // The pill is a second window; without this the app would stop quitting.
    destroyOverlay()
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

/** Register a requested accelerator and report what is actually live. */
async function applyHotkeyPreference(payload: unknown): Promise<HotkeySetResult> {
  const requested = typeof payload === 'string' ? payload : ''
  const rejected = (message: string): HotkeySetResult => ({
    accelerator: activeHotkey,
    requested,
    ok: false,
    fallbackUsed: false,
    message
  })
  const parsed = parseAccelerator(payload)
  if (!parsed.ok) return rejected(parsed.error.message)
  if (!hotkeySource) return rejected('快捷键服务尚未就绪。')
  // Re-registering unregisters the current accelerator, which would swallow
  // the stop press mid-dictation; only a quiet session may rebind.
  const currentState = session?.state ?? 'idle'
  if (currentState !== 'idle' && currentState !== 'error') {
    return rejected('录音或识别过程中不能更改快捷键。')
  }

  const outcome = await registerHotkeyWithFallback(hotkeySource, parsed.value.accelerator)
  activeHotkey = outcome.accelerator
  hotkeyNotice = outcome.message
  if (outcome.message) console.warn('[hotkey]', outcome.message)
  return {
    accelerator: activeHotkey,
    requested: parsed.value.accelerator,
    ok: outcome.ok,
    fallbackUsed: outcome.fallbackUsed,
    message: outcome.message
  }
}

app.whenReady().then(async () => {
  themeStore = new ThemeStore(app.getPath('userData'))
  vocabularyStore = new VocabularyStore(app.getPath('userData'))
  const preferences = await themeStore.loadPreferences()
  themePreference = preferences.theme
  providerPreference = new ProviderPreferenceStore(app.getPath('userData'))
  preferredProvider = await providerPreference.load()
  applyTheme()
  // Loaded once at startup; the panel's reload path refreshes this too.
  postprocessOptions = (await vocabularyStore.loadDetailed()).options
  nativeTheme.on('updated', () => {
    // Only `system` follows the OS; pinned choices ignore the OS change.
    if (themePreference === 'system') applyTheme()
  })
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
    if (result.ok) {
      const level = levelOf(payload)
      if (level !== null && levelThrottle.shouldSend(Date.now())) updateOverlayLevel(level)
      return
    }
    if (result.error.code === 'NOT_RECORDING') return
    mainWindow?.webContents.send('recording:stop')
    session?.handleCaptureFailed(result.error.message)
  })
  ipcMain.on('overlay:ready', (event) => {
    if (event.sender.id !== overlayWebContentsId()) return
    // Re-pushing here is what makes the first recording after launch visible.
    pushOverlayState()
  })
  ipcMain.on('overlay:cancel', (event) => {
    if (event.sender.id !== overlayWebContentsId()) return
    cancelRecording()
  })
  ipcMain.on('overlay:finish', (event) => {
    if (event.sender.id !== overlayWebContentsId()) return
    finishRecording()
  })
  ipcMain.handle('state:get', (): AppStatus => currentStatus())
  ipcMain.handle('asr:set-provider', async (event, payload: unknown): Promise<AppStatus> => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      console.warn('[asr] rejected untrusted sender')
      return currentStatus()
    }
    return switchAsrProvider(payload)
  })
  ipcMain.handle('preferences:get', async (event): Promise<PreferencesView> => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      console.warn('[preferences] rejected untrusted sender')
      throw new Error('未授权的设置请求。')
    }
    return readPreferencesView()
  })
  ipcMain.handle(
    'preferences:set',
    async (event, payload: unknown): Promise<PreferencesSetResult> => {
      if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
        console.warn('[preferences] rejected untrusted sender')
        throw new Error('未授权的设置请求。')
      }
      // Decide the whole patch before any side effect: `planPreferenceSet`
      // rejects every key as soon as one value is invalid, so a mixed patch can
      // never register a shortcut or persist a half-applied file (spec:
      // settings-surface, "reject a patch ... without writing any part of it").
      const plan = planPreferenceSet(payload)
      let ok = plan.ok
      let message = plan.message
      let hotkeyResult: HotkeySetResult | undefined

      if (ok && plan.update.hotkey !== undefined) {
        hotkeyResult = await applyHotkeyPreference(plan.update.hotkey)
        if (!hotkeyResult.ok) {
          ok = false
          message = hotkeyResult.message
        }
      }

      if (ok) {
        const update: { theme?: ThemePreference; hotkey?: string } = {}
        if (plan.update.theme !== undefined) update.theme = plan.update.theme
        if (hotkeyResult?.ok) update.hotkey = hotkeyResult.accelerator
        if (Object.keys(update).length > 0) {
          try {
            const merged = await themeStore.update(update)
            if (!merged.ok) {
              ok = false
              message = merged.rejected[0]?.reason ?? '设置值无效。'
            } else if (update.theme !== undefined) {
              // Persist before painting so disk and the window cannot disagree.
              themePreference = update.theme
              applyTheme()
            }
          } catch (error) {
            ok = false
            message = `保存设置失败：${error instanceof Error ? error.message : String(error)}`
          }
        }
      }

      const view = await readPreferencesView()
      // One push path for the renderer's single copy.
      mainWindow?.webContents.send('preferences:changed', view)
      return { ok, preferences: view, hotkey: hotkeyResult, message }
    }
  )

  initOverlay({
    preloadPath: preloadPath(),
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    rendererFile: path.join(app.getAppPath(), 'out/renderer/index.html')
  })
  createWindow()
  void runProviderInitialization()

  hotkeySource = new ElectronGlobalShortcutSource(globalShortcut)
  hotkeySource.onPress(() => {
    console.log('[hotkey] event')
    toggleRecording()
  })
  const outcome = await registerHotkeyWithFallback(hotkeySource, preferences.hotkey)
  activeHotkey = outcome.accelerator
  hotkeyNotice = outcome.message
  if (outcome.message) console.warn('[hotkey]', outcome.message)
})

app.on('will-quit', () => {
  void hotkeySource?.stop()
})

app.on('window-all-closed', () => {
  app.quit()
})
