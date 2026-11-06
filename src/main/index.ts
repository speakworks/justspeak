import {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  net,
  screen,
  shell,
  systemPreferences
} from 'electron'
import { existsSync, lstatSync } from 'node:fs'
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
import { HotkeyCaptureController } from '../core/hotkey/capture-controller'
import { hotkeyChangeRefusal } from '../core/hotkey/hotkey-change-guard'
import { registerHotkeyWithFallback } from '../core/hotkey/registration'
import type { HotkeySource } from '../core/hotkey/types'
import { postprocess, type PostprocessOptions } from '../core/postprocess'
import { SessionController } from '../core/session/session-controller'
import { consumePendingNotice } from '../core/session/state-notice'
import {
  parseLlmBackend,
  parseLlmBaseUrl,
  parseLlmModel,
  planPreferenceSet
} from '../core/preferences/merge'
import { summarizeProvider } from '../core/preferences/view'
import { buildDiagnosticsSummary } from '../core/diagnostics/summary'
import { deliverTranscript } from '../core/shell/delivery'
import { packagedRuntimeDir, resolveModelsDir } from './asr/paths'
import { createLevelThrottle, rmsOf } from '../core/overlay/level'
import {
  completeOverlay,
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
  DiagnosticsExportResult,
  HistoryEntry,
  HistoryOutcome,
  HotkeyCaptureEndResult,
  HotkeyCaptureStartResult,
  HotkeySetResult,
  ModelInfo,
  PermissionStatus,
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
import { createFocusProbe } from './focus-probe'
import { ElectronGlobalShortcutSource } from './hotkey-source'
import { collectCrashDumps } from './diagnostics/crash-dumps'
import {
  diagnosticsFileName,
  writeDiagnosticsBundle,
  type DiagnosticsBundleContents
} from './diagnostics/export'
import { DiagnosticsLog } from './diagnostics/log'
import { resolveDiagnosticsTarget } from './diagnostics/target'
import { HistoryStore } from './history-store'
import { LlmManager } from './llm/manager'
import { pasteText } from './injection'
import {
  copyResultPanelText,
  destroyResultPanel,
  hideResultPanel,
  initResultPanel,
  refreshResultPanelEscape,
  replayResultPanel,
  resultPanelWebContentsId,
  showResultPanel,
  suspendResultPanelEscape
} from './result-panel'
import { isTrustedSender } from './ipc-sender'
import { PcmBuffer } from './pcm-buffer'
import { ThemeStore } from './theme-store'
import { VocabularyStore, type VocabularyLoadResult } from './vocabulary-store'

const DARK_BACKGROUND = '#1e1e1e'
const LIGHT_BACKGROUND = '#f2f2f2'

const PROVIDER_OPTIONS: Record<SelectableAsrProviderId, ProviderOption> = {
  qwen3: { id: 'qwen3', label: 'Qwen3-ASR 0.6B', capabilities: QWEN3_CAPABILITIES },
  sensevoice: { id: 'sensevoice', label: 'SenseVoice Small', capabilities: SENSEVOICE_CAPABILITIES }
}

let mainWindow: BrowserWindow | null = null
let rendererReady = false
/** A second launch that arrives before the first window exists focuses it on ready. */
let pendingSecondInstanceFocus = false
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
let historyStore: HistoryStore | undefined
/**
 * Route main-process HTTP through Chromium's stack, so the system proxy and
 * custom CAs that apply to ASR downloads also apply to LLM downloads and
 * OpenAI-compatible endpoints.
 */
const electronFetch = ((input: string | URL | Request, init?: RequestInit) =>
  net.fetch(input as string, init)) as typeof fetch

let llmManager: LlmManager | undefined
let diagnosticsExporting = false

// Crashpad runs before app readiness and never uploads; the dump is only
// collected when the user explicitly exports diagnostics.
crashReporter.start({
  productName: 'JustSpeak',
  companyName: 'speakworks',
  uploadToServer: false,
  compress: false
})

const diagnosticsLog = new DiagnosticsLog({
  file: path.join(app.getPath('logs'), 'justspeak.log'),
  redaction: { homeDir: app.getPath('home'), userDataDir: app.getPath('userData') }
})
diagnosticsLog.installConsoleTee()

/** History is created in `whenReady`; IPC handlers only run after the window loads. */
function requireHistoryStore(): HistoryStore {
  if (!historyStore) throw new Error('历史记录尚未就绪。')
  return historyStore
}
let hotkeySource: HotkeySource | undefined
let activeHotkey = DEFAULT_ACCELERATOR
let hotkeyNotice: string | undefined
let hotkeyCapture: HotkeyCaptureController | undefined
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
  if (overlay) {
    if (next === 'recording') transcriptEmittedForOverlay = false
    showOverlay(overlay)
  } else {
    // A transcript that reached the user gets one last beat on the pill: move
    // the walk to the final bar before the pill fades. An empty capture or a
    // cancellation goes straight to idle without a transcript, so it must not
    // light the completion bar.
    if (next === 'idle') {
      if (transcriptEmittedForOverlay) completeOverlay()
      transcriptEmittedForOverlay = false
    }
    if (next === 'error') transcriptEmittedForOverlay = false
    hideOverlay()
  }
}

/** Set when the session emits a non-empty transcript for the current recording. */
let transcriptEmittedForOverlay = false

function sendTranscript(event: TranscriptEvent): void {
  if (event.text.trim() !== '') transcriptEmittedForOverlay = true
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
  const llmConfig = {
    backend: stored.llmBackend,
    baseUrl: stored.llmBaseUrl,
    model: stored.llmModel
  }
  // Reads are side-effect free: reconfiguring the corrector here let a stale
  // read re-apply an old backend after a newer write. Wiring happens at startup
  // and after a successful write instead.
  const llm = llmManager
    ? await llmManager.status(llmConfig)
    : {
        backend: stored.llmBackend,
        endpoint: { baseUrl: stored.llmBaseUrl, model: stored.llmModel, hasKey: false },
        local: {
          runtimeReady: false,
          modelReady: false,
          modelName: '',
          modelPath: '',
          state: 'idle' as const
        },
        message: '智能清理尚未初始化。'
      }
  return {
    theme: themePreference,
    hotkey: activeHotkey,
    hotkeyMessage: hotkeyNotice,
    vocabulary: summarizeVocabulary(vocabulary),
    provider: describeProvider(),
    llm
  }
}

let llmStatusPushTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Sidecar lifecycle changes are not preference writes, but the settings row
 * renders them. Push a fresh view on transitions (debounced so the
 * starting→ready pair does not spam the renderer); without this the panel
 * would keep showing "正在启动…" forever or "已就绪" after a crash.
 */
function schedulePreferencesPush(): void {
  if (llmStatusPushTimer) return
  llmStatusPushTimer = setTimeout(() => {
    llmStatusPushTimer = undefined
    if (!mainWindow || mainWindow.isDestroyed()) return
    void readPreferencesView()
      .then((view) => mainWindow?.webContents.send('preferences:changed', view))
      .catch((error) => console.warn('[llm] status push failed', error))
  }, 250)
}

function readPermissions(): PermissionStatus {
  return {
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    microphone: systemPreferences.getMediaAccessStatus('microphone')
  }
}

/**
 * Assemble the local-only diagnostics contents. Every field is explicit; the
 * bundle never copies userData, history text, audio, vocabulary entries, or
 * secrets.
 */
async function collectDiagnosticsBundle(): Promise<DiagnosticsBundleContents> {
  const preferences = await readPreferencesView()
  let historyEntries = 0
  if (historyStore) {
    try {
      historyEntries = (await historyStore.list()).length
    } catch {
      historyEntries = 0
    }
  }
  const summary = buildDiagnosticsSummary({
    generatedAt: new Date().toISOString(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      locale: app.getLocale()
    },
    preferences,
    permissions: readPermissions(),
    historyEntries,
    redaction: { homeDir: app.getPath('home'), userDataDir: app.getPath('userData') }
  })

  const logBase = path.join(app.getPath('logs'), 'justspeak.log')
  const logs = [logBase, `${logBase}.1`, `${logBase}.2`]
    .filter((file) => {
      try {
        // The log path is predictable; never export a symlink planted there.
        const info = lstatSync(file)
        return info.isFile() && !info.isSymbolicLink()
      } catch {
        return false
      }
    })
    .map((file) => ({ name: path.basename(file), path: file }))
  const dumps = await collectCrashDumps(app.getPath('crashDumps'))

  return {
    summary,
    logs,
    crashDumps: dumps.map((dump) => ({ name: path.basename(dump.path), path: dump.path }))
  }
}

/**
 * The capture behind the in-flight transcript. `getAudio` clears the PCM
 * buffer, so this is the only copy left for history once transcription starts;
 * the next recording start drops whatever an earlier failure left behind.
 */
let historyAudio: AudioInput | undefined

function getAudio(): AudioInput {
  const { pcm } = pcmBuffer.finish()
  const audio: AudioInput = {
    pcm,
    sampleRate: 16000,
    channels: 1,
    durationMs: Math.round((pcm.length / 16000) * 1000)
  }
  historyAudio = audio
  return audio
}

function makeSession(provider: AsrProvider, fake: boolean): SessionController {
  // `single` returns the inner provider untouched; `auto` passes through for any
  // utterance inside the provider limit and only wraps long ones.
  const selected = createTranscriptionProvider(provider, segmentationMode, {
    segmenter: segmenterOptions,
    onPartialFailure: (error) => {
      pendingSegmentFailure = error.message
      console.warn('[segment]', error.message)
    }
  })
  return new SessionController({
    provider: selected,
    // Exactly one target: a focused app window means the renderer inserts, and
    // no keystroke is synthesized, so the text cannot land twice.
    paste: (text: string) =>
      deliverTranscript(text, {
        appFocused: () => mainWindow?.isFocused() ?? false,
        probeFocus,
        insert: (out) => mainWindow?.webContents.send('transcript:insert', out),
        paste: pasteText,
        showPanel: (out) => showResultPanel(out, effectiveTheme())
      }),
    sendState,
    sendTranscript,
    onTranscriptSettled: (event, settlement) => {
      // History is a convenience, never part of the dictation contract: a
      // failed write is logged and the session still reports success.
      if (!historyStore) {
        console.warn('[history] store not ready; transcript was not recorded')
        return
      }
      const audio = historyAudio
      historyAudio = undefined
      // A silent capture can still complete; an empty row helps nobody.
      if (event.text.trim() === '') return
      const outcome: HistoryOutcome = settlement.ok
        ? settlement.target === 'insert'
          ? 'inserted'
          : settlement.target === 'paste'
            ? 'pasted'
            : 'panel'
        : 'paste_failed'
      void historyStore
        .append(
          event,
          outcome,
          audio === undefined ? undefined : { pcm: audio.pcm, sampleRate: audio.sampleRate }
        )
        .then(() => mainWindow?.webContents.send('history:changed'))
        .catch((error) => console.warn('[history] could not record transcript', error))
    },
    fake,
    // The stage sits between the provider result and paste, so the fake and
    // the local provider both go through it.
    postprocess: (text) => postprocess(text, postprocessOptions),
    refine: (text) => llmManager?.corrector.refine(text) ?? Promise.resolve(undefined),
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
    // Packaged: appRoot points inside the read-only app.asar, so weights live in
    // userData (see resolveModelsDir) while the runtime ships in the bundle at
    // Contents/Resources/runtime (see packagedRuntimeDir / scripts/package-runtime.ts).
    modelsDir: resolveModelsDir({
      appRoot,
      userDataDir: app.getPath('userData'),
      packaged: app.isPackaged
    }),
    runtimeDir: app.isPackaged ? packagedRuntimeDir(process.resourcesPath) : undefined,
    catalog: MODEL_CATALOG,
    env: process.env
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
      const manager = new ModelManager({ fetch: electronFetch })
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
    historyAudio = undefined
    hideResultPanel()
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

/** One Accessibility probe for the whole process; it spawns `osascript`. */
const probeFocus = createFocusProbe()

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

  // The shell is full-height and its sheet flexes, so no state can change the
  // window's scroll height; 720×640 is chosen for reading comfort, not for a
  // worst-case measurement. Shrink only, never grow, on a smaller display.
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

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (!pendingSecondInstanceFocus || !mainWindow) return
    pendingSecondInstanceFocus = false
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  mainWindow.on('closed', () => {
    // The pill and the copy panel are extra windows; without this the app
    // would stop quitting.
    destroyOverlay()
    destroyResultPanel()
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

/**
 * How long a settings recorder may hold the dictation key unregistered. The
 * environment override exists so the Electron E2E can exercise the restore
 * path without waiting the full window.
 */
const HOTKEY_CAPTURE_TIMEOUT_MS = (() => {
  // Only the E2E harness may shorten the safety window.
  const raw =
    process.env.JUSTSPEAK_E2E === '1'
      ? Number(process.env.JUSTSPEAK_HOTKEY_CAPTURE_TIMEOUT_MS)
      : Number.NaN
  return Number.isFinite(raw) && raw >= 100 ? raw : 15_000
})()

async function finishHotkeyCapture(): Promise<HotkeyCaptureEndResult> {
  if (!hotkeyCapture) return { ok: true, accelerator: activeHotkey }
  return hotkeyCapture.cancel()
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
  // the stop press mid-dictation; only a quiet session may rebind. This is the
  // same gate the capture path uses, so the two can never diverge.
  const refusal = hotkeyChangeRefusal(session?.state ?? 'idle')
  if (refusal !== null) return rejected(refusal)

  // Applying is also how a press-to-record capture ends successfully: the new
  // binding supersedes the temporary unregistration, so no restore is needed.
  hotkeyCapture?.releaseForApply()

  const outcome = await registerHotkeyWithFallback(hotkeySource, parsed.value.accelerator)
  activeHotkey = outcome.accelerator
  hotkeyNotice = outcome.message
  if (outcome.message) console.warn('[hotkey]', outcome.message)
  // The hotkey source unregisters every accelerator first; a visible copy panel
  // must get its temporary Escape back (or drop the hint if registration fails).
  refreshResultPanelEscape()
  return {
    accelerator: activeHotkey,
    requested: parsed.value.accelerator,
    ok: outcome.ok,
    fallbackUsed: outcome.fallbackUsed,
    message: outcome.message
  }
}

/**
 * One writer for one history directory. A second instance would rewrite
 * `entries.jsonl` from its own stale snapshot and silently drop rows the first
 * instance just appended, so the second launch focuses the existing window and
 * exits instead.
 */
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else
  app.on('second-instance', () => {
    if (!mainWindow) {
      pendingSecondInstanceFocus = true
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  themeStore = new ThemeStore(app.getPath('userData'))
  vocabularyStore = new VocabularyStore(app.getPath('userData'))
  historyStore = new HistoryStore(app.getPath('userData'))
  // Startup is one of the two retention points; the other is every append.
  void historyStore
    .sweep()
    .catch((error) => console.warn('[history] startup sweep failed', error))
  const preferences = await themeStore.loadPreferences()
  themePreference = preferences.theme
  try {
    llmManager = await LlmManager.create({
      appRoot: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      packaged: app.isPackaged,
      userDataDir: app.getPath('userData'),
      fetch: electronFetch,
      onLocalStatusChange: () => schedulePreferencesPush()
    })
    llmManager.configure({
      backend: preferences.llmBackend,
      baseUrl: preferences.llmBaseUrl,
      model: preferences.llmModel
    })
  } catch (error) {
    console.warn('[llm] optional correction backend unavailable', error)
  }
  providerPreference = new ProviderPreferenceStore(app.getPath('userData'))
  preferredProvider = await providerPreference.load()
  applyTheme()
  // Loaded once at startup; the panel's reload path refreshes this too.
  postprocessOptions = (await vocabularyStore.loadDetailed()).options
  nativeTheme.on('updated', () => {
    // Only `system` follows the OS; pinned choices ignore the OS change.
    if (themePreference === 'system') applyTheme()
  })
  ipcMain.on('renderer:ready', (event) => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) return
    rendererReady = true
    console.log('[renderer] ready')
  })
  ipcMain.on('recording:toggle', (event) => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) return
    toggleRecording()
  })
  ipcMain.on('capture:started', (event, atMs: number) => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) return
    console.log('[capture] started', atMs)
    session?.handleCaptureStarted(atMs)
  })
  ipcMain.on('capture:stopped', (event, summary: unknown) => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) return
    void session?.handleCaptureStopped(summary)
  })
  ipcMain.on('capture:failed', (event, message: unknown) => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) return
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
  ipcMain.on('panel:ready', (event) => {
    if (event.sender.id !== resultPanelWebContentsId()) return
    replayResultPanel()
  })
  ipcMain.on('panel:copy', (event) => {
    if (event.sender.id !== resultPanelWebContentsId()) return
    copyResultPanelText()
  })
  ipcMain.on('panel:close', (event) => {
    if (event.sender.id !== resultPanelWebContentsId()) return
    hideResultPanel()
  })
  ipcMain.handle('state:get', (event): AppStatus => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      throw new Error('未授权的状态请求。')
    }
    return currentStatus()
  })
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
        const update: {
          theme?: ThemePreference
          hotkey?: string
          llmBackend?: PreferencesView['llm']['backend']
          llmBaseUrl?: string
          llmModel?: string
        } = {}
        if (plan.update.theme !== undefined) update.theme = plan.update.theme
        if (hotkeyResult?.ok) update.hotkey = hotkeyResult.accelerator
        if (plan.update.llmBackend !== undefined) update.llmBackend = plan.update.llmBackend
        if (plan.update.llmBaseUrl !== undefined) update.llmBaseUrl = plan.update.llmBaseUrl
        if (plan.update.llmModel !== undefined) update.llmModel = plan.update.llmModel
        if (Object.keys(update).length > 0) {
          try {
            const merged = await themeStore.update(update)
            if (!merged.ok) {
              ok = false
              message = merged.rejected[0]?.reason ?? '设置值无效。'
            } else {
              if (update.theme !== undefined) {
                // Persist before painting so disk and the window cannot disagree.
                themePreference = update.theme
                applyTheme()
              }
              if (
                update.llmBackend !== undefined ||
                update.llmBaseUrl !== undefined ||
                update.llmModel !== undefined
              ) {
                // Configure from the merged record, which is fresher than any
                // concurrent read and contains all three LLM fields.
                llmManager?.configure({
                  backend: parseLlmBackend(merged.record.llmBackend),
                  baseUrl: parseLlmBaseUrl(merged.record.llmBaseUrl),
                  model: parseLlmModel(merged.record.llmModel)
                })
              }
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

  ipcMain.handle(
    'hotkey:capture-start',
    async (event): Promise<HotkeyCaptureStartResult> => {
      if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
        console.warn('[hotkey] rejected untrusted capture start')
        throw new Error('未授权的快捷键请求。')
      }
      if (!hotkeyCapture) return { ok: false, message: '快捷键服务尚未就绪。' }
      const refusal = hotkeyChangeRefusal(session?.state ?? 'idle')
      if (refusal !== null) return { ok: false, message: refusal }
      // The controller unregisters the dictation key first, so the app's own
      // global shortcut cannot swallow the chord being recorded.
      return hotkeyCapture.start()
    }
  )

  ipcMain.handle(
    'hotkey:capture-end',
    async (event): Promise<HotkeyCaptureEndResult> => {
      if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
        console.warn('[hotkey] rejected untrusted capture end')
        throw new Error('未授权的快捷键请求。')
      }
      const result = await finishHotkeyCapture()
      // Restoring can fail and fall back to the default, which changes what the
      // settings row must show even though no new binding was applied.
      mainWindow?.webContents.send('preferences:changed', await readPreferencesView())
      return result
    }
  )
  ipcMain.handle('llm:set-key', async (event, key: unknown) => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      return { ok: false, message: '未授权的设置请求。' }
    }
    if (!llmManager) return { ok: false, message: '智能清理尚未初始化。' }
    if (typeof key !== 'string' || key.trim().length === 0 || key.length > 4096) {
      return { ok: false, message: 'API Key 无效。' }
    }
    try {
      await llmManager.keyStore.save(key.trim())
      const view = await readPreferencesView()
      mainWindow?.webContents.send('preferences:changed', view)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('llm:clear-key', async (event) => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      return { ok: false, message: '未授权的设置请求。' }
    }
    if (!llmManager) return { ok: false, message: '智能清理尚未初始化。' }
    try {
      await llmManager.keyStore.clear()
      const view = await readPreferencesView()
      mainWindow?.webContents.send('preferences:changed', view)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('llm:download-model', async (event) => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      return { ok: false, message: '未授权的设置请求。' }
    }
    if (!llmManager) return { ok: false, message: '智能清理尚未初始化。' }
    try {
      await llmManager.download((percent) => {
        mainWindow?.webContents.send('llm:download', {
          state: 'downloading',
          percent
        })
      })
      const view = await readPreferencesView()
      mainWindow?.webContents.send('preferences:changed', view)
      mainWindow?.webContents.send('llm:download', { state: 'ready' })
      // Warm the newly downloaded model while the success message is shown.
      void llmManager.corrector.warmup()
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mainWindow?.webContents.send('llm:download', { state: 'error', message })
      return { ok: false, message }
    }
  })

  ipcMain.handle('permissions:get', (event): PermissionStatus => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      throw new Error('未授权的权限查询。')
    }
    // `false` asks without prompting: the first-run screen must explain the
    // permission before macOS can show its own dialog.
    return readPermissions()
  })

  ipcMain.handle('diagnostics:export', async (event): Promise<DiagnosticsExportResult> => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      return { ok: false, message: '未授权的诊断请求。' }
    }
    if (diagnosticsExporting) return { ok: false, message: '诊断导出正在进行。' }
    diagnosticsExporting = true
    try {
      // Include the lines generated up to the click, including any immediately
      // preceding failure the user is reporting.
      await diagnosticsLog.flush()
      const contents = await collectDiagnosticsBundle()
      const options = {
        title: '导出诊断',
        defaultPath: path.join(app.getPath('downloads'), diagnosticsFileName()),
        filters: [{ name: 'Zip', extensions: ['zip'] }]
      }
      // A dev-only path keeps the Playwright export test out of a native dialog.
      const resolved = await resolveDiagnosticsTarget({
        devTarget: app.isPackaged ? undefined : process.env.JUSTSPEAK_DIAGNOSTICS_EXPORT,
        showSaveDialog: () =>
          mainWindow
            ? dialog.showSaveDialog(mainWindow, options)
            : dialog.showSaveDialog(options)
      })
      if (resolved.canceled) return { ok: false, canceled: true }
      await writeDiagnosticsBundle(contents, resolved.target, {
        stagingRoot: app.getPath('temp')
      })
      return { ok: true, path: resolved.target }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    } finally {
      diagnosticsExporting = false
    }
  })
  ipcMain.handle('permissions:open-accessibility', async (event): Promise<void> => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      throw new Error('未授权的权限请求。')
    }
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    )
  })
  ipcMain.handle('history:list', async (event): Promise<HistoryEntry[]> => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      console.warn('[history] rejected untrusted sender')
      throw new Error('未授权的历史记录请求。')
    }
    return requireHistoryStore().list()
  })
  ipcMain.handle('history:delete', async (event, id: unknown): Promise<HistoryEntry[]> => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      console.warn('[history] rejected untrusted sender')
      throw new Error('未授权的历史记录请求。')
    }
    if (typeof id !== 'string' || id.length === 0) throw new Error('历史记录 id 无效。')
    const entries = await requireHistoryStore().remove(id)
    mainWindow?.webContents.send('history:changed')
    return entries
  })
  ipcMain.handle('history:audio', async (event, id: unknown): Promise<ArrayBuffer | null> => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      console.warn('[history] rejected untrusted sender')
      throw new Error('未授权的历史记录请求。')
    }
    if (typeof id !== 'string' || id.length === 0) throw new Error('历史记录 id 无效。')
    return requireHistoryStore().readAudio(id)
  })
  ipcMain.handle('clipboard:write-text', async (event, text: unknown): Promise<void> => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      console.warn('[clipboard] rejected untrusted sender')
      throw new Error('未授权的剪贴板请求。')
    }
    if (typeof text !== 'string') throw new Error('复制内容无效。')
    clipboard.writeText(text)
  })

  initOverlay({
    preloadPath: preloadPath(),
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    rendererFile: path.join(app.getAppPath(), 'out/renderer/index.html')
  })
  initResultPanel({
    preloadPath: preloadPath(),
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    rendererFile: path.join(app.getAppPath(), 'out/renderer/index.html')
  })
  createWindow()
  void runProviderInitialization()

  hotkeySource = new ElectronGlobalShortcutSource(globalShortcut)
  hotkeyCapture = new HotkeyCaptureController({
    source: hotkeySource,
    timeoutMs: HOTKEY_CAPTURE_TIMEOUT_MS,
    timer: {
      set: (callback, delayMs) => setTimeout(callback, delayMs),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
    getActive: () => activeHotkey,
    setActive: (accelerator, message) => {
      activeHotkey = accelerator
      hotkeyNotice = message
      if (message) console.warn('[hotkey]', message)
    },
    onRegistrationChanged: (suspended) => {
      if (suspended) suspendResultPanelEscape()
      else refreshResultPanelEscape()
    },
    onRestored: (result) => {
      mainWindow?.webContents.send('hotkey:capture-ended', result)
      void readPreferencesView()
        .then((view) => mainWindow?.webContents.send('preferences:changed', view))
        .catch((error: unknown) => console.warn('[hotkey] safety restore refresh failed', error))
    },
    setMenuShortcutsIgnored: (ignored) => {
      // Native menu equivalents would otherwise fire before the recorder's
      // keydown: Command+Q would quit, Command+R would reload the renderer.
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.setIgnoreMenuShortcuts(ignored)
      }
    }
  })
  hotkeySource.onPress(() => {
    console.log('[hotkey] event')
    toggleRecording()
  })
  const outcome = await registerHotkeyWithFallback(hotkeySource, preferences.hotkey)
  activeHotkey = outcome.accelerator
  hotkeyNotice = outcome.message
  if (outcome.message) console.warn('[hotkey]', outcome.message)
})

let flushingHistoryForQuit = false

app.on('will-quit', (event) => {
  hotkeyCapture?.dispose()
  void hotkeySource?.stop()
  if (flushingHistoryForQuit) return
  // A transcript appended just before Cmd+Q must reach disk, and the optional
  // LLM sidecar must not survive the parent process. `app.quit()` does not wait
  // for pending promises, so hold the quit until both are done or bounded.
  event.preventDefault()
  flushingHistoryForQuit = true
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3500))
  const history = historyStore
    ? historyStore.flush().catch((error) => console.warn('[history] flush on quit failed', error))
    : Promise.resolve()
  const llm = llmManager?.dispose(true) ?? Promise.resolve()
  const logs = diagnosticsLog.flush()
  void Promise.race([
    Promise.all([history, llm, logs]),
    timeout
    // `app.exit` skips another `will-quit` pass; re-entering `quit()` while the
    // first quit is suspended is what wedges Electron's shutdown.
  ]).finally(() => app.exit(0))
})

app.on('window-all-closed', () => {
  app.quit()
})
