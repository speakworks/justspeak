import type { AsrCapabilities } from '../core/asr/types'

export type AppState = 'idle' | 'recording' | 'transcribing' | 'pasting' | 'error'

export type RecordingCommand = 'start' | 'stop'

export interface RecordingSummary {
  durationMs: number
  samples: number
  sampleRate: number
  rms: number
}

/** Providers a user may select in the app. Fake is test-only. */
export const SELECTABLE_ASR_PROVIDER_IDS = ['qwen3', 'sensevoice'] as const
export type SelectableAsrProviderId = (typeof SELECTABLE_ASR_PROVIDER_IDS)[number]

/** Capabilities come from the provider, not from a provider-id lookup. */
export interface ProviderOption {
  id: SelectableAsrProviderId
  label: string
  capabilities: AsrCapabilities
}

export interface AsrProviderSelection {
  id: SelectableAsrProviderId
  options: ProviderOption[]
}

export interface ModelInfo {
  id: string
  name: string
  license: string
  sourceUrl: string
  sizeBytes: number
  quantization: string
  capabilities: AsrCapabilities
}

export interface AppStatus {
  state: AppState
  message?: string
  modelInfo?: ModelInfo
  asr?: AsrProviderSelection
}

/** Result of a preference hotkey round trip; `accelerator` is what is live. */
export interface HotkeySetResult {
  accelerator: string
  requested: string
  ok: boolean
  fallbackUsed: boolean
  message?: string
}

/**
 * Press-to-record brackets the capture with these two calls. Starting one
 * temporarily unregisters the dictation accelerator so the chord being
 * recorded is not swallowed by the app's own global shortcut.
 */
export interface HotkeyCaptureStartResult {
  ok: boolean
  message?: string
}

export interface HotkeyCaptureEndResult {
  ok: boolean
  /** The accelerator that is live after the capture ended. */
  accelerator: string
  message?: string
}

/** `system` follows macOS appearance; `light` / `dark` pin it. */
export type ThemePreference = 'system' | 'light' | 'dark'

/** What the renderer should paint after resolving `system` against the OS. */
export type ResolvedTheme = 'light' | 'dark'

/**
 * The vocabulary file is separate from `preferences.json`, but its summary
 * travels on the same preferences surface so the panel never reads disk itself.
 */
export interface VocabularySummary {
  /** Absolute path of `userData/vocabulary.json`. */
  path: string
  /** `default`: no file yet; `loaded`: parsed; `unreadable`: present but bad. */
  state: 'default' | 'loaded' | 'unreadable'
  replaceCount: number
  protectCount: number
  /** Why the file could not be used; only set when `state` is `unreadable`. */
  message?: string
}

export interface ProviderSummary {
  id: string
  label: string
  /** Whether the user can switch provider right now (the picker lives in settings). */
  selectable: boolean
  /** What is missing before this setting can be changed. */
  reason: string
}

/** Optional LLM cleanup. `off` is the default and the only safe first run. */
export type LlmBackend = 'off' | 'local' | 'endpoint'

export interface LlmEndpointView {
  baseUrl: string
  model: string
  /** True when a key is stored; the key itself never reaches the renderer. */
  hasKey: boolean
}

/** Lifecycle of the local llama.cpp sidecar, as reported to the settings row. */
export type LlmLocalState = 'idle' | 'starting' | 'ready' | 'failed'

export interface LlmLocalView {
  runtimeReady: boolean
  modelReady: boolean
  modelName: string
  modelPath: string
  state: LlmLocalState
  /** Why the sidecar failed, when `state` is `failed`. */
  error?: string
}

export interface LlmPreferencesView {
  backend: LlmBackend
  endpoint: LlmEndpointView
  local: LlmLocalView
  /** Why the current backend cannot run, or a download/loading notice. */
  message?: string
}

export interface LlmDownloadEvent {
  state: 'downloading' | 'ready' | 'error'
  percent?: number
  message?: string
}

/** Result of the user-initiated, local-only diagnostics export. */
export interface DiagnosticsExportResult {
  ok: boolean
  canceled?: boolean
  path?: string
  message?: string
}

/**
 * Update-client state transitions pushed to the settings row (OpenSpec
 * `app-update`). The feed result is honest: a needs-signature event means the
 * running bundle is not Developer ID signed, so no check ran.
 */
export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'up-to-date'; version: string }
  | { type: 'available'; version: string }
  | { type: 'downloading'; percent: number }
  | { type: 'ready-to-install' }
  | { type: 'needs-signature' }
  | { type: 'error'; message: string }

/** The only writable part of the update policy: the automatic check toggle. */
export interface UpdateAutoCheckPatch {
  enabled: boolean
}

/** The settings row's read view of the updater. */
export interface UpdateStatusView {
  /** The fixed feed; the renderer displays it in the privacy note. */
  feedUrl: string
  /** Whether the bundle carries a Developer ID signature. */
  signed: boolean
  /** True while a check's HTTP request is in flight. */
  checking: boolean
}

/** Everything the settings panel renders, read from one place in main. */
export interface PreferencesView {
  theme: ThemePreference
  /** The accelerator currently registered with the OS; `''` means none. */
  hotkey: string
  /** Non-empty when the stored binding was refused and a fallback was used. */
  hotkeyMessage?: string
  vocabulary: VocabularySummary
  provider: ProviderSummary
  llm: LlmPreferencesView
  /** The 自动检查更新 toggle, from the stored preference (`false` default). */
  updateAutoCheck: boolean
}

/** `systemPreferences.getMediaAccessStatus` on macOS. */
export type MediaAccessStatus =
  | 'not-determined'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'unknown'

/** What the first-run screen and the settings surface may show about permissions. */
export interface PermissionStatus {
  accessibility: boolean
  microphone: MediaAccessStatus
}

/** Only these keys can be written; anything else is rejected, not stored. */
export interface PreferencesPatch {
  theme?: ThemePreference
  hotkey?: string
  llmBackend?: LlmBackend
  llmBaseUrl?: string
  llmModel?: string
}

export interface PreferencesSetResult {
  ok: boolean
  preferences: PreferencesView
  /** Present when the patch carried a hotkey, mirroring the OS outcome. */
  hotkey?: HotkeySetResult
  message?: string
}

/**
 * One worklet batch. `samples` is 16 kHz mono PCM16; main rejects anything
 * above the batch bound before appending it to the session buffer.
 */
export interface PcmBatch {
  sequence: number
  capturedAtMs: number
  samples: Int16Array
}

export interface TranscriptEvent {
  text: string
  fake: boolean
  durationMs: number
  latencyMs: number
  /** Post-processing rule ids that changed the raw ASR text, in order. */
  applied?: string[]
}

/** What happened to a finished transcript after it was recognised. */
export const HISTORY_OUTCOMES = ['inserted', 'pasted', 'paste_failed', 'panel'] as const
export type HistoryOutcome = (typeof HISTORY_OUTCOMES)[number]

/** Audio saved next to a history entry (phase 2); relative to `history/`. */
export interface HistoryAudioRef {
  file: string
  bytes: number
}

/** One row in the local transcript history. */
export interface HistoryEntry {
  id: string
  text: string
  /** Epoch milliseconds, local-time grouping happens in the renderer. */
  createdAt: number
  outcome: HistoryOutcome
  fake: boolean
  durationMs: number
  latencyMs: number
  audio?: HistoryAudioRef
}

/** What the recording pill renders; main pushes it, the pill never polls. */
export interface OverlayState {
  state: 'recording' | 'working'
  theme: 'light' | 'dark'
}

/** What the copy panel renders; main pushes it, the panel never polls. */
export interface ResultPanelPayload {
  text: string
  theme: ResolvedTheme
  /** False when the OS refused the temporary Escape shortcut. */
  canEscape: boolean
}

export interface JustSpeakApi {
  toggleRecording: () => void
  getState: () => Promise<AppStatus>
  sendRendererReady: () => void
  sendCaptureStarted: (atMs: number) => void
  sendCaptureStopped: (summary: RecordingSummary) => void
  sendCaptureFailed: (message: string) => void
  sendPcmBatch: (batch: PcmBatch) => void
  setAsrProvider: (provider: SelectableAsrProviderId) => Promise<AppStatus>
  /** Reads theme/hotkey/vocabulary from main; main re-reads disk each call. */
  getPreferences: () => Promise<PreferencesView>
  /** Writes one or more preferences through the single preferences surface. */
  setPreferences: (patch: PreferencesPatch) => Promise<PreferencesSetResult>
  /** Temporarily unregisters the dictation hotkey so a new chord can be pressed. */
  beginHotkeyCapture: () => Promise<HotkeyCaptureStartResult>
  /** Restores the previous hotkey after a cancelled or timed-out recording. */
  endHotkeyCapture: () => Promise<HotkeyCaptureEndResult>
  /** Main ends a capture on its own (safety timeout) and reports the live key. */
  onHotkeyCaptureEnded: (listener: (result: HotkeyCaptureEndResult) => void) => () => void
  /** Stores an endpoint key encrypted; the key never returns to the renderer. */
  setLlmKey: (key: string) => Promise<{ ok: boolean; message?: string }>
  clearLlmKey: () => Promise<{ ok: boolean; message?: string }>
  /** Downloads the pinned local correction model with SHA-256 verification. */
  downloadLlmModel: () => Promise<{ ok: boolean; message?: string }>
  onLlmDownload: (listener: (event: LlmDownloadEvent) => void) => () => void
  /** Writes a local zip of versions, logs, and crash dumps; never uploads. */
  exportDiagnostics: () => Promise<DiagnosticsExportResult>
  /**
   * Queries the fixed update feed. In an unsigned build no request is made:
   * the row instead states 自动更新需要正式签名版.
   */
  checkForUpdate: () => Promise<UpdateStatusView>
  /** Persists the 自动检查更新 toggle; the schedule re-arms from policy. */
  setUpdateAutoCheck: (patch: UpdateAutoCheckPatch) => Promise<void>
  /** Downloads the update after the user confirmed this specific version. */
  downloadUpdate: () => Promise<void>
  /** Installs a downloaded update (restarts the app). */
  installUpdate: () => void
  /** Update-client events; pushed by main, the row never polls. */
  onUpdateEvent: (listener: (event: UpdateEvent) => void) => () => void
  /** The row's initial view of the updater, so it renders before any check. */
  getUpdateStatus: () => Promise<UpdateStatusView>
  /** Reads the two permissions the dictation path needs. Never prompts. */
  getPermissions: () => Promise<PermissionStatus>
  /** Opens System Settings → Privacy & Security → Accessibility. */
  openAccessibilitySettings: () => Promise<void>
  /** Overlay-only: the pill's state, retained by main and re-pushed on ready. */
  onOverlayState: (listener: (state: OverlayState) => void) => () => void
  /** Overlay-only: microphone level, 0..1, throttled to <=30 per second. */
  onOverlayLevel: (listener: (level: number) => void) => () => void
  /** Overlay-only: the transcript is delivered; move the walk to the last bar. */
  onOverlayComplete: (listener: () => void) => () => void
  /** Overlay-only: tells main the pill has mounted, so the retained state is pushed. */
  overlayReady: () => void
  /** Overlay-only: cancel the recording and discard it. */
  cancelRecording: () => void
  /** Overlay-only: finish the recording (same path as the hotkey's stop). */
  finishRecording: () => void
  /** Panel-only: the retained text and resolved theme. */
  onPanelText: (listener: (payload: ResultPanelPayload) => void) => () => void
  /** Panel-only: tells main it has mounted, so the retained text is pushed. */
  panelReady: () => void
  /** Panel-only: copy the retained text and dismiss. */
  copyPanelText: () => void
  /** Panel-only: dismiss without copying. */
  closeResultPanel: () => void
  onState: (listener: (state: AppState, message?: string) => void) => () => void
  /**
   * Every finished transcript, whichever target it went to. The home input
   * receives it through `onTranscriptInsert`; main persists it independently
   * and tells the history pane through `onHistoryChanged`.
   */
  onTranscript: (listener: (event: TranscriptEvent) => void) => () => void
  /** Fires instead of a paste when the app's own window holds focus. */
  onTranscriptInsert: (listener: (text: string) => void) => () => void
  onRecordingCommand: (listener: (command: RecordingCommand) => void) => () => void
  /**
   * Main asks the renderer to show a destination — the menu bar's 设置 item
   * opens the window and needs the settings view, which is renderer state.
   */
  onMenuNavigate: (listener: (destination: 'settings') => void) => () => void
  /** Fires after main accepts a preference write or re-reads it. */
  onPreferencesChanged: (listener: (preferences: PreferencesView) => void) => () => void
  /** Transcript history, newest first. */
  getHistory: () => Promise<HistoryEntry[]>
  /** Remove one entry; resolves with the surviving list, newest first. */
  deleteHistoryEntry: (id: string) => Promise<HistoryEntry[]>
  /** WAV bytes for one entry's recording; null once audio was evicted. */
  getHistoryAudio: (id: string) => Promise<ArrayBuffer | null>
  /** Writes text to the system clipboard (used by the history copy action). */
  copyText: (text: string) => Promise<void>
  /** Fires when main appended or removed an entry; refetch with `getHistory`. */
  onHistoryChanged: (listener: () => void) => () => void
}
