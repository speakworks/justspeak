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
  /** Whether the user can switch provider right now (the picker lives in the header). */
  selectable: boolean
  /** What is missing before this setting can be changed. */
  reason: string
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
}

/** Only these keys can be written; anything else is rejected, not stored. */
export interface PreferencesPatch {
  theme?: ThemePreference
  hotkey?: string
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

/** What the recording pill renders; main pushes it, the pill never polls. */
export interface OverlayState {
  state: 'recording' | 'working'
  theme: 'light' | 'dark'
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
  /** Overlay-only: the pill's state, retained by main and re-pushed on ready. */
  onOverlayState: (listener: (state: OverlayState) => void) => () => void
  /** Overlay-only: microphone level, 0..1, throttled to <=30 per second. */
  onOverlayLevel: (listener: (level: number) => void) => () => void
  /** Overlay-only: tells main the pill has mounted, so the retained state is pushed. */
  overlayReady: () => void
  /** Overlay-only: cancel the recording and discard it. */
  cancelRecording: () => void
  /** Overlay-only: finish the recording (same path as the hotkey's stop). */
  finishRecording: () => void
  onState: (listener: (state: AppState, message?: string) => void) => () => void
  onTranscript: (listener: (event: TranscriptEvent) => void) => () => void
  /** Fires instead of a paste when the app's own window holds focus. */
  onTranscriptInsert: (listener: (text: string) => void) => () => void
  onRecordingCommand: (listener: (command: RecordingCommand) => void) => () => void
  /** Fires after main accepts a preference write or re-reads it. */
  onPreferencesChanged: (listener: (preferences: PreferencesView) => void) => () => void
}
