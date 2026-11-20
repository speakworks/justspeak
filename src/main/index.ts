import {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
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
import {
  DEFAULT_UNDO_WINDOW_MINUTES,
  TARGET_SWITCHED_MESSAGE,
  buildInjectionRecord,
  compareTargetIdentity,
  evaluateUndoGuard,
  identityCopyMessage,
  isReSayCandidate,
  reSayFallbackNotice,
  undoRefusalTitle,
  undoWindowMs,
  undoWindowOpen,
  type InjectionRecord
} from '../core/injection/undo'
import {
  MAX_UNDO_CHARS,
  describeDeletionFailure,
  isPreKeyRefusal,
  isTargetSwitchMidDelete,
  isTargetSwitchRefusal
} from '../core/injection/delete'
import {
  PASTE_LOCK_BUSY_MESSAGE,
  PASTE_LOCK_BUSY_NOTICE,
  UndoLock,
  createLockedPaste,
  isPasteLockBusyError
} from '../core/injection/undo-lock'
import { postprocess, type PostprocessOptions } from '../core/postprocess'
import type { FocusTarget } from '../core/focus/editability'
import { SessionController } from '../core/session/session-controller'
import { consumePendingNotice } from '../core/session/state-notice'
import {
  parseLlmBackend,
  parseLlmBaseUrl,
  parseLlmModel,
  parseUndoWindowMinutes,
  planPreferenceSet
} from '../core/preferences/merge'
import {
  applyAutostartChoice,
  readAutostartView,
  seedAutostartOnFirstRun,
  type AutostartWriteResult
} from '../core/preferences/autostart'
import { resolveProviderSupportsTerms, summarizeProvider } from '../core/preferences/view'
import { buildDiagnosticsSummary } from '../core/diagnostics/summary'
import {
  deliverTranscriptDetailed,
  type DeliveryPorts,
  type DeliveryTarget
} from '../core/shell/delivery'
import { closeAction } from '../core/menubar/menu'
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
  AppState,
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
  TranscriptSegmentMeta,
  ReinsertResult,
  UndoResult,
  UndoStateView,
  UpdateStatusView,
  VocabularySaveResult,
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
  resolveSegmentationMode,
  shouldRebuildForSegmentation,
  type SegmentationMode,
  type SegmentationResolution
} from './asr/segmentation-mode'
import type { SegmentationPreference } from '../core/preferences/segmentation'
import { createFocusTargetProbe } from './focus-probe'
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
import { deleteIfTargetMatches, activateRunningApp, pasteText } from './injection'
import {
  attachResultPanelEntry,
  copyResultPanelText,
  destroyResultPanel,
  hideResultPanel,
  hideResultPanelWindow,
  initResultPanel,
  notifyResultPanelUndoChanged,
  refreshResultPanelEscape,
  replayResultPanel,
  resultPanelContext,
  resultPanelWebContentsId,
  scheduleResultPanelHide,
  setResultPanelTarget,
  showResultPanel,
  suspendResultPanelEscape,
  type ResultPanelShowOptions
} from './result-panel'
import { isTrustedSender } from './ipc-sender'
import { createTray, destroyTray, refreshTray } from './tray'
import { UpdateController } from './update'
import { PcmBuffer } from './pcm-buffer'
import { ThemeStore } from './theme-store'
import { VocabularyStore, type VocabularyLoadResult } from './vocabulary-store'
import { createSaveQueue, saveVocabularyPayload } from './vocabulary-save'
import { STARTER_VOCABULARY_TERMS } from './vocabulary-starter'
import { createLoginItemController, type LoginItemController } from './login-item'

const DARK_BACKGROUND = '#1e1e1e'
const LIGHT_BACKGROUND = '#f2f2f2'

const PROVIDER_OPTIONS: Record<SelectableAsrProviderId, ProviderOption> = {
  qwen3: { id: 'qwen3', label: 'Qwen3-ASR 0.6B', capabilities: QWEN3_CAPABILITIES },
  sensevoice: { id: 'sensevoice', label: 'SenseVoice Small', capabilities: SENSEVOICE_CAPABILITIES }
}

let mainWindow: BrowserWindow | null = null
let rendererReady = false
/**
 * Set while a real quit is in progress, so the window's `close` handler lets
 * the window go instead of hiding it.
 *
 * This has to be set *before* `app.quit()`, not in `will-quit`: Electron closes
 * the windows first and only emits `will-quit` once they are gone. A flag set
 * there would arrive after the handler that consults it, and a prevented close
 * would mean `will-quit` never fires — the app could never quit at all.
 */
let quitting = false
/** The user closed the window, so `ready-to-show` must not reopen it. */
let windowHiddenByUser = false
/** A second launch that arrives before the first window exists focuses it on ready. */
let pendingSecondInstanceFocus = false
let session: SessionController | null = null
let sessionMode: AsrMode = DEFAULT_ASR_MODE
let activeProvider: AsrProvider | null = null
let providerError: string | undefined
let initializing = false
/**
 * True once a provider build has completed with a usable session. Until then
 * the saved 长句听写 preference must not be reported as "applies next launch":
 * the first build simply has not run yet.
 */
let providerInitialized = false
let pcmBuffer = new PcmBuffer()
let activeModelInfo: ModelInfo | undefined
let themePreference: ThemePreference = 'system'
let themeStore: ThemeStore
/** The macOS login-item adapter; created in `whenReady` like every store. */
let loginItem: LoginItemController | undefined
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

/**
 * The update client and its policy (OpenSpec `app-update`). The controller is
 * created in `whenReady`, like every store, so its codesign probe and schedule
 * see the packaged app rather than a half-started one. Created as non-null via
 * the same late-binding pattern as `themeStore`.
 */
let updateController: UpdateController
/**
 * Cache of the persisted update policy, refreshed on every read of the store:
 * the scheduler's tick needs a synchronous view of the toggle.
 */
const cachedUpdatePolicy: { autoCheck: boolean; lastCheckAtMs: number } = {
  autoCheck: false,
  lastCheckAtMs: 0
}

/**
 * The 自动检查更新 toggle and the last automatic check time live in
 * `preferences.json` like every other preference — merged, not replaced — so a
 * future key cannot be dropped by an update write.
 */
async function loadUpdatePolicy(): Promise<{ autoCheck: boolean; lastCheckAtMs: number }> {
  const stored = await themeStore.loadPreferences()
  return {
    autoCheck: stored.updateAutoCheck,
    lastCheckAtMs: stored.updateLastCheckAtMs
  }
}

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
/** The stored 长句听写 choice; the env override is resolved separately. */
let segmentationPreference: SegmentationPreference = 'auto'
let segmentationMode: SegmentationMode = 'auto'
let segmenterOptions: SegmenterOptions | undefined
/** How the last successful provider build resolved the env/preference pair. */
let segmentationResolution: SegmentationResolution = {
  effective: 'auto',
  source: 'preference'
}
/** The in-flight transcript's segment metadata, shown on the copy panel. */
let pendingTranscriptSegments: TranscriptSegmentMeta[] | undefined
/**
 * A partial segmented transcript is returned as provider success (the frozen
 * provider contract cannot carry text and an error together). Main attaches
 * the typed failure message to the next idle event so the user still learns
 * which segment was lost.
 */
let pendingSegmentFailure: string | undefined
/**
 * A destination the menu bar asked for before the renderer subscribed; replayed
 * on `renderer:ready` so a click on 设置… cannot be silently lost.
 */
let pendingMenuDestination: 'settings' | undefined

/**
 * The correction slot (OpenSpec `injection-undo`). Exactly one insertion is
 * remembered, in memory only; there is no persisted undo history.
 */
let lastInjection: InjectionRecord | undefined
/** Cached window so the guard never awaits disk on the keystroke path. */
let undoWindowMinutes = DEFAULT_UNDO_WINDOW_MINUTES
/**
 * What the in-flight transcript did, captured before history settles so the
 * undo record can be built with the exact focus the paste saw.
 */
let lastDelivery: { target: DeliveryTarget; focus: FocusTarget | null; atMs: number } | undefined
/**
 * The snapshot for a re-say run. Set when a recording starts inside the undo
 * window and consumed by the next delivery; `undefined` means a normal run.
 */
let reSayCandidate: InjectionRecord | undefined
/** Only one guarded deletion may be in flight at a time. */
const undoLock = new UndoLock()
/**
 * Every paste into a target app goes through the same lock as deletions. A
 * paste that starts while the Backspace loop is running waits briefly; on
 * timeout it is refused instead of having its tail deleted.
 */
const lockedPaste = createLockedPaste(undoLock, pasteText)

/**
 * The copy panel for a fresh transcript. Every fallback path uses this so the
 * run's segment metadata can never be dropped just because a paste was
 * refused.
 */
function showTranscriptPanel(
  text: string,
  options: ResultPanelShowOptions = {}
): void {
  showResultPanel(text, effectiveTheme(), {
    ...options,
    ...(pendingTranscriptSegments === undefined
      ? {}
      : { segments: pendingTranscriptSegments })
  })
}

/**
 * The delivery-port paste. A lock-busy refusal must not hide the text: write
 * it to the clipboard and show the result panel before re-throwing, so the
 * session's error path is honest and the words remain visible and copyable.
 */
async function pasteWithVisibility(text: string): Promise<void> {
  try {
    await lockedPaste(text)
  } catch (error) {
    if (isPasteLockBusyError(error)) {
      clipboard.writeText(text)
      showTranscriptPanel(text, {
        title: '撤销正在进行，未插入',
        notice: PASTE_LOCK_BUSY_NOTICE
      })
    }
    throw error
  }
}

class UnavailableAsrProvider implements AsrProvider {
  readonly id = 'unavailable'
  readonly capabilities: AsrCapabilities = {
    languages: [],
    streaming: false,
    punctuation: false,
    itn: false,
    timestamps: false,
    vad: false,
    vocabularyBias: false,
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
  // The menu bar's dictation item and the window's state must never disagree;
  // this is the one place every transition passes through.
  refreshTray()
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
  // The copy panel is shown from the delivery ports, which only receive text;
  // retain this run's metadata so the panel can disclose its segments.
  pendingTranscriptSegments = event.segments
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Push a change of the undo slot to every surface that offers it: the app
 * menu, the menu-bar icon, and the history pane. Called whenever the slot is
 * set, linked to a history row, or cleared.
 */
function notifyUndoChanged(): void {
  mainWindow?.webContents.send('undo:changed')
  notifyResultPanelUndoChanged()
  refreshApplicationMenu()
  refreshTray()
}

/** The slot as the history pane may offer it. */
function currentUndoState(): UndoStateView {
  const record = lastInjection
  if (record === undefined) return { available: false }
  const windowMs = undoWindowMs(undoWindowMinutes)
  const available =
    record.method === 'paste' &&
    // Without an identity or a known grapheme count the guard always refuses;
    // do not advertise an action that cannot run. The fixed cap is the same
    // reason: an over-cap record can never be deleted automatically.
    record.focusIdentity !== '' &&
    record.length !== null &&
    record.length <= MAX_UNDO_CHARS &&
    undoWindowOpen(record, Date.now(), windowMs)
  return {
    available,
    ...(record.entryId === undefined ? {} : { entryId: record.entryId }),
    expiresAt: record.atMs + windowMs
  }
}

/** The ports every delivery path uses; one probe, one clipboard, one panel. */
function deliveryPorts(): DeliveryPorts {
  return {
    appFocused: () => mainWindow?.isFocused() ?? false,
    probeTarget: probeFocusTarget,
    insert: (out) => mainWindow?.webContents.send('transcript:insert', out),
    paste: pasteWithVisibility,
    showPanel: (out) => showTranscriptPanel(out)
  }
}

/** Rebuild the probe shape from a record, for the panel's reinsertion guard. */
function recordAsTarget(record: InjectionRecord): FocusTarget {
  return {
    kind: record.method === 'paste' ? 'editable' : 'non-editable',
    appName: record.appName,
    bundleId: record.bundleId,
    role: record.focusRole,
    identity: record.focusIdentity,
    // This shape is only for the panel's identity comparison; the caret in the
    // record belongs to insertion time, not to the current target.
    selection: null
  }
}

/** The argv the atomic delete script receives for a recorded insertion. */
function deleteExpectation(record: InjectionRecord) {
  return {
    appName: record.appName,
    bundleId: record.bundleId,
    role: record.focusRole,
    identity: record.focusIdentity
  }
}

/**
 * Deliver only the new text and keep the old text copyable. Shared by every
 * re-say path that must not delete (guard refusal or a concurrent undo).
 */
async function deliverReSayFallback(
  text: string,
  candidate: InjectionRecord,
  reasonText: string,
  ports: DeliveryPorts = deliveryPorts(),
  targetSwitched = false
): Promise<DeliveryTarget> {
  const outcome = await deliverTranscriptDetailed(text, ports)
  if (outcome.target === 'panel' && outcome.focus !== null) {
    setResultPanelTarget(outcome.focus)
  }
  lastDelivery = { target: outcome.target, focus: outcome.focus, atMs: Date.now() }
  const notice = reSayFallbackNotice({
    targetSwitched,
    reasonText,
    inserted: outcome.target !== 'panel'
  })
  if (outcome.target === 'panel') {
    showResultPanel(`${text}\n\n${candidate.text}`, effectiveTheme(), {
      title: '旧文本未删除',
      notice
    })
  } else {
    showResultPanel(candidate.text, effectiveTheme(), {
      title: '旧文本未删除',
      notice,
      ...(candidate.entryId === undefined ? {} : { entryId: candidate.entryId }),
      target: recordAsTarget(candidate)
    })
  }
  return outcome.target
}

/**
 * B1: the guarded 撤销上一次插入. Every entry point funnels through here.
 *
 * The slot is consumed before the first key press, and only one deletion may be
 * in flight. A refusal never sends a delete key; it preserves the text.
 */
async function performUndoLastInjection(): Promise<UndoResult> {
  if (undoLock.locked) return { ok: false, message: '撤销正在进行，请稍候。' }
  const record = lastInjection
  const evaluate = (target: FocusTarget) =>
    evaluateUndoGuard({
      record,
      nowMs: Date.now(),
      windowMs: undoWindowMs(undoWindowMinutes),
      appFocused: mainWindow?.isFocused() ?? false,
      target
    })
  let target = await probeFocusTarget()
  let decision = evaluate(target)

  // Undo invoked from our own menu or history makes JustSpeak frontmost, so
  // the recorded app must be brought back before the guard can mean anything.
  // A closed app is never launched; the refusal path preserves the text.
  if (
    !decision.ok &&
    record !== undefined &&
    record.bundleId !== null &&
    // No identity or no count means the guard can never pass; do not bring an
    // app forward for a deletion that will be refused anyway.
    record.focusIdentity !== '' &&
    record.length !== null &&
    (decision.reason === 'app-changed' || decision.reason === 'focus-changed')
  ) {
    if (await activateRunningApp(record.bundleId)) {
      await delay(250)
      target = await probeFocusTarget()
      decision = evaluate(target)
    }
  }

  if (!decision.ok) {
    // A guard-level target change gets the one fixed user-visible sentence.
    // `unverifiable-target` also covers a probe that could not read the app.
    const targetSwitched =
      decision.reason === 'app-changed' ||
      decision.reason === 'focus-changed' ||
      decision.reason === 'unverifiable-target'
    const notice = targetSwitched ? TARGET_SWITCHED_MESSAGE : decision.message
    if (decision.note !== undefined) console.warn('[undo]', decision.note)
    if (record !== undefined) {
      showResultPanel(record.text, effectiveTheme(), {
        title: undoRefusalTitle(decision.reason),
        notice,
        ...(record.entryId === undefined ? {} : { entryId: record.entryId }),
        target: recordAsTarget(record)
      })
    }
    return { ok: false, message: notice }
  }

  // The check and the acquisition are synchronous: a second caller that passed
  // the guard during the probe delay is refused here, before any key. The slot
  // identity is re-checked as well: a caller whose snapshot was already
  // consumed or replaced must never delete against stale text.
  if (!undoLock.tryAcquire()) {
    return { ok: false, message: '撤销正在进行，请稍候。' }
  }
  try {
    if (lastInjection !== record) {
      return { ok: false, message: '撤销正在进行或已完成，未发送删除键。' }
    }
    const consumed = record
    if (consumed === undefined) {
      return { ok: false, message: '没有可撤销的插入。' }
    }
    // Clear the re-say snapshot only now, inside the same critical section as
    // the slot consumption: a narrow race must not silently downgrade a re-say
    // to a plain paste.
    reSayCandidate = undefined
    // Mark the slot consumed before the script starts so a concurrent caller
    // cannot act on it. A pre-key abort restores it below; a mid-delete abort
    // leaves it consumed.
    lastInjection = undefined
    notifyUndoChanged()

    const outcome = await deleteIfTargetMatches(
      deleteExpectation(consumed),
      decision.count,
      decision.expectedCaret
    )
    if (!outcome.ok) {
      const preKey = isPreKeyRefusal(outcome.reason)
      // A pre-key abort pressed no key, so the recorded text is still intact.
      // Restore the slot for a retry, unless a new insertion already replaced
      // it while the script was running.
      if (preKey && lastInjection === undefined) {
        lastInjection = consumed
        notifyUndoChanged()
      }
      const failure = describeDeletionFailure(outcome)
      showResultPanel(consumed.text, effectiveTheme(), {
        title: failure.partial ? '撤销可能未完整完成' : '撤销未完成',
        notice: failure.notice,
        ...(consumed.entryId === undefined ? {} : { entryId: consumed.entryId }),
        target: recordAsTarget(consumed)
      })
      return { ok: false, message: failure.message }
    }
    return { ok: true }
  } finally {
    undoLock.release()
  }
}

/**
 * B2: a re-say delivery. The guard and the identity/delete machinery are the
 * same ones B1 uses. On a pass the old text is deleted first and the new text
 * pasted once; on a refusal or a concurrent undo only the new text is
 * delivered and the old text is moved to the panel.
 */
async function replaceTranscript(
  text: string,
  candidate: InjectionRecord
): Promise<DeliveryTarget> {
  const target = await probeFocusTarget()
  const decision = evaluateUndoGuard({
    record: candidate,
    nowMs: Date.now(),
    windowMs: undoWindowMs(undoWindowMinutes),
    appFocused: mainWindow?.isFocused() ?? false,
    target
  })

  if (!decision.ok) {
    const targetSwitched =
      decision.reason === 'app-changed' ||
      decision.reason === 'focus-changed' ||
      decision.reason === 'unverifiable-target'
    if (decision.note !== undefined) console.warn('[re-say]', decision.note)
    return deliverReSayFallback(
      text,
      candidate,
      targetSwitched ? `${TARGET_SWITCHED_MESSAGE}。` : `${undoRefusalTitle(decision.reason)}。`,
      deliveryPorts(),
      targetSwitched
    )
  }

  if (!undoLock.tryAcquire()) {
    return deliverReSayFallback(
      text,
      candidate,
      '另一次撤销正在进行，本次未删除旧文本。'
    )
  }

  try {
    // A stale snapshot (already consumed or replaced) must not delete. This
    // branch already holds the write lock, so its fallback paste must bypass
    // the lock: re-entering createLockedPaste would self-deadlock until the
    // timeout and lose the new text.
    if (lastInjection !== candidate) {
      return deliverReSayFallback(
        text,
        candidate,
        '另一次撤销正在进行或已完成，本次未删除旧文本。',
        { ...deliveryPorts(), paste: pasteText }
      )
    }
    // Mark the slot consumed before the script starts so a concurrent caller
    // cannot act on it. A pre-key abort restores it below; a mid-delete abort
    // leaves it consumed.
    lastInjection = undefined
    notifyUndoChanged()

    const deletion = await deleteIfTargetMatches(
      deleteExpectation(candidate),
      decision.count,
      decision.expectedCaret
    )
    if (!deletion.ok) {
      const preKey = isPreKeyRefusal(deletion.reason)
      // No key was pressed, so the old text is still in place. Restore the
      // slot for a retry unless a new insertion already replaced it.
      if (preKey && lastInjection === undefined) {
        lastInjection = candidate
        notifyUndoChanged()
      }
      const failure = describeDeletionFailure(deletion)
      const targetSwitched =
        isTargetSwitchRefusal(deletion.reason) ||
        isTargetSwitchMidDelete(deletion.reason)
      // A partial-delete message already ends in "删除可能未完整完成"; only the
      // follow-up context is appended here.
      const notice = targetSwitched
        ? failure.notice
        : `${deletion.message}。未插入新文本；这里是新旧两段文本。`
      showResultPanel(`${text}\n\n${candidate.text}`, effectiveTheme(), {
        title: failure.partial ? '旧文本删除未完成' : '旧文本未删除',
        notice
      })
      throw new Error(
        targetSwitched
          ? failure.message
          : failure.partial
            ? `旧文本${deletion.message}`
            : `旧文本未删除：${deletion.message}`
      )
    }

    try {
      await pasteText(text)
    } catch (error) {
      // The old text is already gone; show it as an explicit backup instead of
      // leaving only the raw paste error.
      showResultPanel(candidate.text, effectiveTheme(), {
        title: '旧文本已删除，粘贴失败',
        notice: '旧文本已在目标中删除，这里是备份；新文本留在剪贴板。',
        ...(candidate.entryId === undefined ? {} : { entryId: candidate.entryId }),
        target: recordAsTarget(candidate)
      })
      throw error
    }
    lastDelivery = { target: 'paste', focus: target, atMs: Date.now() }
    return 'paste'
  } finally {
    undoLock.release()
  }
}

/**
 * B3: the result panel's 重新插入. History is rewritten in place first (best
 * effort), then the panel is hidden so macOS can return focus, and the text is
 * inserted only when the target passes the same identity check the undo guard
 * uses. Otherwise the action degrades to copy, which is always safe.
 */
async function reinsertPanelText(input: unknown): Promise<ReinsertResult> {
  if (typeof input !== 'string' || input.trim() === '' || input.length > 20_000) {
    return { inserted: false, message: '重插内容无效。' }
  }
  const text = input
  const context = resultPanelContext()

  if (context?.entryId !== undefined && historyStore) {
    try {
      await historyStore.updateText(context.entryId, text)
      mainWindow?.webContents.send('history:changed')
    } catch (error) {
      console.warn('[history] could not save the edited transcript', error)
    }
  }

  hideResultPanelWindow()
  // Give the window server a moment to return focus to the app behind us.
  await delay(200)
  const target = await probeFocusTarget()
  const original = context?.target
  // One identity implementation for undo and reinsertion: app, bundle, role,
  // and a non-empty element identity. A different field in the same app is a
  // mismatch, not a paste target.
  const identity =
    original === undefined
      ? {
          ok: false as const,
          reason: 'unverifiable-target' as const,
          message: '无法确认原来的输入位置，未做自动删除。'
        }
      : compareTargetIdentity(original, target)

  if (identity.ok && target.kind === 'editable') {
    try {
      // Reinsertion is a write into a target app too: wait for an in-flight
      // deletion rather than letting its tail Backspaces eat the new text.
      await lockedPaste(text)
    } catch (error) {
      if (isPasteLockBusyError(error)) {
        // The reinsertion was refused by an in-flight deletion; keep the text
        // visible and copyable instead of losing it with the error.
        clipboard.writeText(text)
        showResultPanel(text, effectiveTheme(), {
          title: '撤销正在进行，未插入',
          notice: PASTE_LOCK_BUSY_NOTICE
        })
        scheduleResultPanelHide(2_500)
        return { inserted: false, message: PASTE_LOCK_BUSY_MESSAGE }
      }
      const message = error instanceof Error ? error.message : String(error)
      showResultPanel(text, effectiveTheme(), {
        title: '重新插入失败',
        notice: message
      })
      scheduleResultPanelHide(2_500)
      return { inserted: false, message }
    }
    lastInjection =
      buildInjectionRecord({
        text,
        atMs: Date.now(),
        method: 'paste',
        target,
        ...(context?.entryId === undefined ? {} : { entryId: context.entryId })
      }) ?? undefined
    notifyUndoChanged()
    return { inserted: true }
  }

  const reason = identity.ok ? '焦点不再可编辑' : identityCopyMessage(identity.reason)
  clipboard.writeText(text)
  showResultPanel(text, effectiveTheme(), {
    title: '已复制',
    notice: `${reason}，文本已复制到剪贴板。`
  })
  scheduleResultPanelHide(1_500)
  return { inserted: false, message: `${reason}，文本已复制到剪贴板。` }
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
  // The live capability is authoritative; while no provider is live (startup,
  // or after a provider error) fall back to the selected provider's static
  // capability so the row does not claim "unsupported" for a model that does
  // support terms. `fake` and an unknown mode resolve to false.
  const selectedCapabilities =
    sessionMode in PROVIDER_OPTIONS
      ? PROVIDER_OPTIONS[sessionMode as SelectableAsrProviderId].capabilities
      : undefined
  return {
    path: vocabularyStore.file,
    state: result.state,
    termCount: result.termList.terms.length,
    replaceCount: result.options.vocabulary?.replace?.length ?? 0,
    protectCount: result.options.vocabulary?.protect?.length ?? 0,
    terms: result.options.terms ?? [],
    replace: result.options.vocabulary?.replace ?? [],
    protect: result.options.vocabulary?.protect ?? [],
    starterTerms: [...STARTER_VOCABULARY_TERMS],
    // Only the visible comma reason; the cap and invalid discards stay silent.
    droppedTermCount: result.termList.droppedByComma,
    // The cap discard is surfaced in the 词典 area, not as a save failure.
    droppedByCapCount: result.termList.droppedByCap,
    providerSupportsTerms: resolveProviderSupportsTerms(
      activeProvider?.capabilities,
      selectedCapabilities
    ),
    ...(result.message === undefined ? {} : { message: result.message })
  }
}

/**
 * The one read path for the settings panel. Theme comes from disk (so a
 * hand-edited file is honoured); the hotkey is the accelerator actually live;
 * the vocabulary file is re-read so this call doubles as "reload".
 */
async function readPreferencesView(loginItemNotice?: string): Promise<PreferencesView> {
  const stored = await themeStore.loadPreferences()
  if (stored.theme !== themePreference) {
    themePreference = stored.theme
    applyTheme()
  }
  // Keep the keystroke-path cache aligned with what was just read.
  undoWindowMinutes = stored.undoWindowMinutes
  const loginItemView = readAutostartView(
    () =>
      loginItem?.read() ?? {
        available: false,
        openAtLogin: false,
        status: 'not-registered' as const,
        message: '登录项服务尚未就绪。'
      },
    loginItemNotice
  )
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
    llm,
    // The OS owns this value; `read` never throws.
    loginItem: loginItemView,
    updateAutoCheck: stored.updateAutoCheck,
    undoWindowMinutes: stored.undoWindowMinutes,
    segmentation: {
      preference: stored.segmentation,
      effective: segmentationMode,
      source: segmentationResolution.source,
      ...(segmentationResolution.envValue === undefined
        ? {}
        : { envValue: segmentationResolution.envValue }),
      ...(segmentationResolution.envInvalid ? { envInvalid: true } : {}),
      // A mode can only be named as effective while a provider is live.
      providerReady: activeProvider !== null && providerError === undefined && !initializing,
      // A busy pipeline defers the rebuild; the saved choice then applies on
      // the next provider build (a provider switch, retry, or launch). Before
      // the first build has finished there is nothing to compare against.
      restartRequired:
        providerInitialized &&
        segmentationResolution.source === 'preference' &&
        stored.segmentation !== segmentationMode
    }
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
    paste: async (text: string) => {
      // A re-say run consumes its snapshot exactly once; a normal run leaves
      // the slot alone.
      const candidate = reSayCandidate
      reSayCandidate = undefined
      if (candidate !== undefined) return replaceTranscript(text, candidate)

      const outcome = await deliverTranscriptDetailed(text, deliveryPorts())
      if (outcome.target === 'panel' && outcome.focus !== null) {
        setResultPanelTarget(outcome.focus)
      }
      lastDelivery = {
        target: outcome.target,
        focus: outcome.focus,
        atMs: Date.now()
      }
      return outcome.target
    },
    sendState,
    sendTranscript,
    onTranscriptSettled: (event, settlement) => {
      const delivered = lastDelivery
      lastDelivery = undefined
      const audio = historyAudio
      historyAudio = undefined
      // A silent capture can still complete; an empty row helps nobody.
      if (event.text.trim() === '') return

      // Only a real paste or a panel display creates a correction record; the
      // app's own input has its own editable text and caret.
      const base =
        settlement.ok &&
        delivered !== undefined &&
        delivered.focus !== null &&
        (delivered.target === 'paste' || delivered.target === 'panel')
          ? buildInjectionRecord({
              text: event.text,
              atMs: delivered.atMs,
              method: delivered.target === 'paste' ? 'paste' : 'panel',
              target: delivered.focus
            })
          : null

      // Set the slot immediately so the menu and the history action are live
      // even while the history append is still in flight; the entry id is
      // attached when the write resolves.
      if (base !== null) {
        lastInjection = base
        notifyUndoChanged()
      }

      // History is a convenience, never part of the dictation contract: a
      // failed write is logged and the session still reports success.
      if (!historyStore) {
        console.warn('[history] store not ready; transcript was not recorded')
        return
      }
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
        .then((entry) => {
          // The panel is linked even when the probe could not supply an app
          // identity: the history row still exists and an edit must rewrite it.
          if (delivered?.target === 'panel') attachResultPanelEntry(entry.id, event.text)
          if (base !== null) {
            // Mutate the existing record instead of replacing it: an undo that
            // captured the slot before this append resolved must still see the
            // same object and pass the stale-snapshot check. Only notify while
            // this is still the current slot; a consumed or replaced slot must
            // never be resurrected by a late history write.
            base.entryId = entry.id
            if (lastInjection === base) notifyUndoChanged()
          }
          mainWindow?.webContents.send('history:changed')
        })
        .catch((error) => {
          console.warn('[history] could not record transcript', error)
        })
    },
    fake,
    // The stage sits between the provider result and paste, so the fake and
    // the local provider both go through it.
    postprocess: (text) => postprocess(text, postprocessOptions),
    refine: (text) => llmManager?.corrector.refine(text) ?? Promise.resolve(undefined),
    getAudio,
    // Read per utterance: the vocabulary file may be re-read between runs.
    getVocabulary: () => postprocessOptions.terms ?? [],
    transcribeTimeoutMs: 120_000
  })
}

function failSession(message: string): void {
  providerError = message
  reSayCandidate = undefined
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
  providerInitialized = false
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


  // Experimental segmentation knobs fail closed on a bad *knob*, but an
  // invalid JUSTSPEAK_SEGMENTED value now falls back to the saved preference
  // (with a visible notice) instead of making ASR unusable.
  const segmentation = parseSegmentationConfig(process.env, segmentationPreference)
  if (!segmentation.ok) {
    await disposeActiveProvider()
    session = makeSession(new UnavailableAsrProvider(), false)
    initializing = false
    failSession(segmentation.message)
    return
  }
  segmentationMode = segmentation.config.mode
  segmenterOptions = segmentation.config.segmenter
  segmentationResolution = segmentation.resolution

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
    providerInitialized = true
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
    providerInitialized = true
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
    // Starting inside the undo window turns this run into a re-say; the guard
    // is re-checked at delivery, when the target can actually be probed.
    reSayCandidate = isReSayCandidate(
      lastInjection,
      Date.now(),
      undoWindowMs(undoWindowMinutes)
    )
      ? lastInjection
      : undefined
    pendingSegmentFailure = undefined
    pendingTranscriptSegments = undefined
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
const probeFocusTarget = createFocusTargetProbe()

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
  reSayCandidate = undefined
  pcmBuffer.finish()
  mainWindow?.webContents.send('recording:stop')
}

/** The pill's ✓: only meaningful while capturing; a toggle from idle would start one. */
function finishRecording(): void {
  if (!session || session.state !== 'recording') return
  toggleRecording()
}

/**
 * The application menu, with the product's own entry points.
 *
 * Electron's default template carries 视图 → 重新加载 and 开发者工具, which in a
 * resident dictation app are two ways to break a running session from a menu
 * item the user probably clicked by accident. The dictation entries mirror the
 * menu-bar icon so the app is fully usable from either place. 退出 keeps its
 * role, which sets the quit path the window's `close` handler looks for.
 */
function buildApplicationMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            label: '设置…',
            accelerator: 'Command+,',
            click: () => {
              showMainWindow()
              openSettings()
            }
          },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit', label: '退出 JustSpeak' }
        ]
      },
      {
        label: '听写',
        submenu: [
          {
            // No `accelerator` property. On macOS `registerAccelerator` is
            // ignored (`@platform linux,win32`), so a key equivalent here would
            // be live and double-fire with the same chord registered through
            // `globalShortcut` — one press, two toggles, an instant stop. The
            // live chord is named in the label instead; the binding itself is
            // `globalShortcut`'s, refreshed by `refreshApplicationMenu()`.
            label: `开始 / 结束听写（${activeHotkey}）`,
            click: () => {
              showMainWindow()
              toggleRecording()
            }
          },
          {
            label: '撤销上一次插入',
            enabled: currentUndoState().available,
            click: () => {
              void performUndoLastInjection()
            }
          },
          { type: 'separator' },
          {
            label: '显示主窗口',
            click: () => showMainWindow()
          }
        ]
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' }
        ]
      },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { role: 'zoom', label: '缩放' },
          { type: 'separator' },
          { role: 'front', label: '前置全部窗口' }
        ]
      }
    ])
  )
}

/**
 * End the app from an in-app entry point. `before-quit` also covers the paths
 * this function never sees (`Cmd+Q`, the Dock's 退出, the menu role); setting the
 * flag here keeps the intent local and makes the two agree.
 */
function quitApp(): void {
  quitting = true
  app.quit()
}

/**
 * The 听写 menu item names the live hotkey, so the menu is rebuilt whenever the
 * chord changes — at startup (from the default to the stored binding, possibly
 * after a fallback) and on every successful rebind in settings.
 */
function refreshApplicationMenu(): void {
  if (!app.isReady()) return
  buildApplicationMenu()
}

// `before-quit` is the only hook that runs *ahead* of Electron closing the
// windows, which is what the window's `close` handler reads. Setting `quitting`
// in `will-quit` instead would be too late: the prevented close would mean
// `will-quit` never fires, and the app could never quit.
app.on('before-quit', () => {
  quitting = true
})

/**
 * Bring the window back from any state the menu bar can leave it in — hidden,
 * minimized, or (between `closed` and the next `whenReady` path) absent. A
 * resident app must never have an unreachable window.
 */
function showMainWindow(): void {
  // Coming back on purpose supersedes an earlier close, so a still-pending
  // `ready-to-show` may show the window again.
  windowHiddenByUser = false
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  // Electron 45's `show`/`hide` events do not fire for a programmatic
  // `show()` (they come from occlusion-state changes), so the tray's window
  // item would keep saying 显示主窗口 until the next state change.
  refreshTray()
}

/** Show or hide the window, matching the tray item's current label. */
function toggleMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    // Going through `close()` sends it through the same hide path the title
    // bar button uses, so `windowHiddenByUser` is set by that handler.
    mainWindow.close()
    return
  }
  showMainWindow()
}

/** Show the window on the settings destination, from any launch state. */
function openSettings(): void {
  pendingMenuDestination = 'settings'
  showMainWindow()
  // A mounted renderer receives this directly; an unmounted one picks it up
  // from `pendingMenuDestination` on `renderer:ready`.
  mainWindow?.webContents.send('menu:navigate', 'settings')
}

function createWindow(): void {
  const preload = preloadPath()
  if (!existsSync(preload)) {
    dialog.showErrorBox('JustSpeak', `Preload script missing: ${preload}`)
    quitApp()
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
      sandbox: true,
      // The microphone capture runs in this renderer (getUserMedia +
      // AudioWorklet). Closing the window now hides it instead of destroying it,
      // and Chromium throttles hidden renderers by default — timers slow and the
      // audio worklet can be starved, so dictation from the hotkey or the menu
      // bar would drop audio. This is why the flag is required, not a nicety.
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    // A close that lands before the first paint must not be undone by the
    // deferred show: the window has `show: false`, so the user could have
    // closed it while it was still hidden and `ready-to-show` would pop it back.
    if (!windowHiddenByUser) mainWindow?.show()
    if (!pendingSecondInstanceFocus || !mainWindow) return
    pendingSecondInstanceFocus = false
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  /**
   * Closing the window keeps the app resident: the hotkey, the menu-bar icon
   * and the dictation pipeline all live in main, and the renderer that owns the
   * microphone keeps running while hidden. A real quit (`Cmd+Q`, the Dock, or
   * the menu bar's 退出) sets `quitting` first, so it is never turned into a
   * hide.
   */
  mainWindow.on('close', (event) => {
    if (closeAction({ quitting }) === 'hide') {
      event.preventDefault()
      windowHiddenByUser = true
      mainWindow?.hide()
      refreshTray()
    }
  })
  mainWindow.on('show', () => refreshTray())
  mainWindow.on('hide', () => refreshTray())
  mainWindow.on('minimize', () => refreshTray())
  mainWindow.on('restore', () => refreshTray())
  mainWindow.on('closed', () => {
    // The pill and the copy panel are extra windows; without this the app
    // would stop quitting.
    destroyOverlay()
    destroyResultPanel()
    mainWindow = null
    rendererReady = false
    refreshTray()
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
    quitApp()
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererReady = false
    const message = `界面进程异常退出：${details.reason}`
    session?.fail(message)
    dialog.showErrorBox('JustSpeak', `${message}。请重启应用。`)
    quitApp()
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
  // The menu-bar tooltip and the 听写 menu item both name the live key.
  refreshTray()
  refreshApplicationMenu()
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
    // With the window hidden rather than destroyed, a second launch is another
    // way back to a visible window — the same path the Dock and the menu bar use.
    if (!mainWindow) {
      pendingSecondInstanceFocus = true
      return
    }
    showMainWindow()
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
  undoWindowMinutes = preferences.undoWindowMinutes
  segmentationPreference = preferences.segmentation
  loginItem = createLoginItemController()
  try {
    const seeded = await seedAutostartOnFirstRun(preferences.launchAtLogin, {
      read: () => loginItem!.read(),
      set: (openAtLogin) => loginItem!.set(openAtLogin),
      persist: async (openAtLogin) => {
        const merged = await themeStore.update({ launchAtLogin: openAtLogin })
        if (!merged.ok) throw new Error(merged.rejected[0]?.reason ?? '开机自启记录失败。')
      }
    })
    if (seeded && !seeded.ok) {
      // Nothing is persisted, so the next launch retries the default instead
      // of treating an unconfirmed registration as a user choice of off.
      console.warn('[login-item] first-run default was not confirmed', seeded.message)
    }
  } catch (error) {
    console.warn('[login-item] first-run seeding failed', error)
  }
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
  {
    // Seed the scheduler's cache once; the host callbacks keep it in sync.
    const policy = await loadUpdatePolicy()
    cachedUpdatePolicy.autoCheck = policy.autoCheck
    cachedUpdatePolicy.lastCheckAtMs = policy.lastCheckAtMs
  }
  updateController = new UpdateController()
  updateController.init({
    // The toggle and the last-check time live in preferences.json; the host
    // cache makes them synchronous reads for the scheduler, and every write
    // goes back through the merge so no other key is dropped.
    autoCheckEnabled: () => cachedUpdatePolicy.autoCheck,
    lastCheckAtMs: () => cachedUpdatePolicy.lastCheckAtMs,
    onAutoCheckRan: (atMs) => {
      cachedUpdatePolicy.lastCheckAtMs = atMs
      void themeStore
        .update({ updateLastCheckAtMs: atMs })
        .catch((error) => console.warn('[update] last check persist failed', error))
    },
    onEvent: (event) => {
      mainWindow?.webContents.send('update:event', event)
    }
  })
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
    // 菜单栏的 设置… may have been chosen before React mounted its listener;
    // replay it here so the request is never silently dropped.
    if (pendingMenuDestination) {
      mainWindow?.webContents.send('menu:navigate', pendingMenuDestination)
      pendingMenuDestination = undefined
    }
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
    reSayCandidate = undefined
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
  ipcMain.on('panel:copy', (event, text: unknown) => {
    if (event.sender.id !== resultPanelWebContentsId()) return
    if (typeof text === 'string' && text.length <= 20_000) copyResultPanelText(text)
    else copyResultPanelText()
  })
  ipcMain.on('panel:close', (event) => {
    if (event.sender.id !== resultPanelWebContentsId()) return
    hideResultPanel()
  })
  ipcMain.handle('panel:reinsert', async (event, text: unknown): Promise<ReinsertResult> => {
    if (event.sender.id !== resultPanelWebContentsId()) {
      return { inserted: false, message: '未授权的重插请求。' }
    }
    return reinsertPanelText(text)
  })
  ipcMain.handle('panel:undo', async (event): Promise<UndoResult> => {
    if (event.sender.id !== resultPanelWebContentsId()) {
      return { ok: false, message: '未授权的撤销请求。' }
    }
    return performUndoLastInjection()
  })
  ipcMain.handle('undo:state', async (event): Promise<UndoStateView> => {
    const fromMain = isTrustedSender(event.sender.id, mainWindow?.webContents.id)
    const fromPanel = event.sender.id === resultPanelWebContentsId()
    if (!fromMain && !fromPanel) {
      throw new Error('未授权的撤销状态请求。')
    }
    return currentUndoState()
  })
  ipcMain.handle('undo:last', async (event): Promise<UndoResult> => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      return { ok: false, message: '未授权的撤销请求。' }
    }
    return performUndoLastInjection()
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

      // The OS is the source of truth for the login item: apply the request,
      // then persist only what the read-back confirmed.
      let autostartResult: AutostartWriteResult | undefined
      if (ok && plan.update.launchAtLogin !== undefined) {
        if (!loginItem) {
          ok = false
          message = '登录项服务尚未就绪。'
        } else {
          try {
            autostartResult = await applyAutostartChoice(plan.update.launchAtLogin, {
              set: (openAtLogin) => loginItem!.set(openAtLogin),
              persist: async (openAtLogin) => {
                const merged = await themeStore.update({ launchAtLogin: openAtLogin })
                if (!merged.ok) {
                  throw new Error(merged.rejected[0]?.reason ?? '开机自启记录失败。')
                }
              }
            })
          } catch (error) {
            ok = false
            message = `保存开机自启失败：${error instanceof Error ? error.message : String(error)}`
          }
          if (autostartResult && !autostartResult.ok) {
            ok = false
            message = autostartResult.message
          }
        }
      }

      if (ok) {
        const update: {
          theme?: ThemePreference
          hotkey?: string
          llmBackend?: PreferencesView['llm']['backend']
          llmBaseUrl?: string
          llmModel?: string
          undoWindowMinutes?: number
          segmentation?: SegmentationPreference
        } = {}
        if (plan.update.theme !== undefined) update.theme = plan.update.theme
        if (hotkeyResult?.ok) update.hotkey = hotkeyResult.accelerator
        if (plan.update.llmBackend !== undefined) update.llmBackend = plan.update.llmBackend
        if (plan.update.llmBaseUrl !== undefined) update.llmBaseUrl = plan.update.llmBaseUrl
        if (plan.update.llmModel !== undefined) update.llmModel = plan.update.llmModel
        if (plan.update.undoWindowMinutes !== undefined) {
          update.undoWindowMinutes = plan.update.undoWindowMinutes
        }
        if (plan.update.segmentation !== undefined) {
          update.segmentation = plan.update.segmentation
        }
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
              if (update.undoWindowMinutes !== undefined) {
                // The merged record is authoritative; the cache survives so the
                // guard never awaits disk on the keystroke path.
                undoWindowMinutes = parseUndoWindowMinutes(merged.record.undoWindowMinutes)
                refreshApplicationMenu()
                refreshTray()
              }
              if (update.segmentation !== undefined) {
                // Keep the in-memory preference current even when the rebuild
                // below has to be deferred; the next build reads it.
                segmentationPreference = update.segmentation
              }
            }
          } catch (error) {
            ok = false
            message = `保存设置失败：${error instanceof Error ? error.message : String(error)}`
          }
        }
      }

      // Apply the 长句听写 choice through the existing provider-build path when
      // it is safe. A busy pipeline or an env takeover defers it; the view then
      // reports `restartRequired` and the panel says it applies next launch.
      if (ok && plan.update.segmentation !== undefined) {
        const resolved = resolveSegmentationMode(process.env, plan.update.segmentation)
        if (
          shouldRebuildForSegmentation({
            resolved,
            currentMode: segmentationMode,
            busy: pipelineBusy(),
            initializing
          })
        ) {
          await runProviderInitialization()
        }
      }

      const view = await readPreferencesView(
        autostartResult && !autostartResult.ok ? autostartResult.message : undefined
      )
      // One push path for the renderer's single copy.
      mainWindow?.webContents.send('preferences:changed', view)
      return { ok, preferences: view, hotkey: hotkeyResult, message }
    }
  )

  // One lane for every vocabulary write. Two overlapping saves would otherwise
  // be able to read each other's file back and report the wrong snapshot.
  const vocabularySaveQueue = createSaveQueue()

  ipcMain.handle(
    'vocabulary:save',
    async (event, payload: unknown): Promise<VocabularySaveResult> => {
      if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
        console.warn('[vocabulary] rejected untrusted save')
        return { ok: false, message: '未授权的词汇表请求。' }
      }
      // The renderer is never trusted: normalise through the file parser, write
      // atomically, then adopt only the read-back options. A failed save must
      // leave the previous in-memory configuration and the old file untouched.
      // The save, the adopt, and the view read share the lane so a later save
      // cannot slip a different file under this report.
      return vocabularySaveQueue(async () => {
        const outcome = await saveVocabularyPayload(vocabularyStore, payload)
        if (!outcome.ok) return { ok: false, message: outcome.message }
        postprocessOptions = outcome.options
        const view = await readPreferencesView()
        mainWindow?.webContents.send('preferences:changed', view)
        return { ok: true, view }
      })
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

  // Update client (OpenSpec `app-update`): the renderer asks, main decides.
  // An unsigned build answers 检查更新 with the honest needs-signature event and
  // never reaches the feed — the check itself is main-side, so the renderer
  // cannot bypass the signature gate by invoking directly.
  ipcMain.handle('update:check', async (event): Promise<UpdateStatusView> => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      console.warn('[update] rejected untrusted check')
      throw new Error('未授权的更新请求。')
    }
    return updateController.check()
  })

  ipcMain.handle('update:set-auto-check', async (event, patch: unknown): Promise<void> => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      console.warn('[update] rejected untrusted policy write')
      throw new Error('未授权的更新请求。')
    }
    // The only writable key is the toggle; anything else is rejected rather
    // than stored.
    if (typeof patch !== 'object' || patch === null || !('enabled' in patch)) {
      throw new Error('自动检查更新开关值无效。')
    }
    if (typeof (patch as { enabled: unknown }).enabled !== 'boolean') {
      throw new Error('自动检查更新开关值无效。')
    }
    const enabled = (patch as { enabled: boolean }).enabled
    const merged = await themeStore.update({ updateAutoCheck: enabled })
    if (!merged.ok) {
      // Never report success for a write that was rejected: the row would
      // show the toggle on while disk kept the old value.
      throw new Error(merged.rejected[0]?.reason ?? '保存自动检查更新开关失败。')
    }
    cachedUpdatePolicy.autoCheck = enabled
    updateController.refreshSchedule()
  })

  ipcMain.handle('update:download', async (event): Promise<void> => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      console.warn('[update] rejected untrusted download')
      throw new Error('未授权的更新请求。')
    }
    // Downloading is only meaningful after the user saw and confirmed a
    // specific version; the gate against unsigned builds is that no `available`
    // event ever fired there.
    await updateController.download()
  })

  ipcMain.handle('update:status', async (event): Promise<UpdateStatusView> => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      throw new Error('未授权的更新请求。')
    }
    return updateController.status()
  })

  ipcMain.on('update:install', (event) => {
    if (!isTrustedSender(event.sender.id, mainWindow?.webContents.id)) {
      console.warn('[update] rejected untrusted install')
      return
    }
    try {
      updateController.install()
    } catch (error) {
      // This is a `send` channel, so a throw here would be an uncaught main
      // exception. Report the refusal to the row instead.
      mainWindow?.webContents.send('update:event', {
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
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
  buildApplicationMenu()
  createWindow()
  createTray({
    iconDir: app.isPackaged
      ? path.join(process.resourcesPath, 'resources')
      : path.join(app.getAppPath(), 'resources'),
    window: () => mainWindow,
    dictation: () => (session?.state ?? 'idle') as AppState,
    hotkey: () => activeHotkey,
    onToggleWindow: () => toggleMainWindow(),
    onToggleDictation: () => toggleRecording(),
    undoAvailable: () => currentUndoState().available,
    onUndoLast: () => {
      void performUndoLastInjection()
    },
    onOpenSettings: openSettings,
    onQuit: () => quitApp()
  })
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
      // The menu-bar tooltip and the 听写 menu item both name the live key, so
      // every change must reach them.
      refreshTray()
      refreshApplicationMenu()
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
  refreshTray()
  // The menu was built with the default chord; this is where it learns the
  // real (possibly fallback) binding.
  refreshApplicationMenu()
})

let flushingHistoryForQuit = false

app.on('will-quit', (event) => {
  destroyTray()
  updateController?.teardown()
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

/**
 * A resident app has no window to close, so losing the last one is no longer a
 * reason to quit. Quitting is explicit: `Cmd+Q`, the Dock's 退出, or the
 * menu-bar menu, each of which sets `quitting` and reaches `will-quit`.
 */
app.on('window-all-closed', () => {
  refreshTray()
})

/**
 * Clicking the Dock icon must bring a hidden window back. Without this the app
 * looks frozen: the icon is there, the menu bar is there, and nothing appears.
 *
 * While the startup chain is still running (`mainWindow` not yet assigned), the
 * handler must record the request and return — `whenReady` is about to create
 * the window. Creating one here would race that call: the second `createWindow`
 * overwrites `mainWindow` and the first renderer is stranded, invisible and
 * unreachable, for the process lifetime.
 */
app.on('activate', () => {
  if (!hasSingleInstanceLock || quitting) return
  if (!mainWindow) {
    pendingSecondInstanceFocus = true
    return
  }
  showMainWindow()
})
