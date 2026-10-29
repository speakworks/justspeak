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
  theme?: ThemePreference
  /** The accelerator currently registered with the OS; `''` means none. */
  hotkey?: string
  /** Non-empty when the stored binding was refused and a fallback was used. */
  hotkeyMessage?: string
}

/** Result of a `hotkey:set` round trip; `accelerator` is what is actually live. */
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

export interface JustSpeakApi {
  toggleRecording: () => void
  getState: () => Promise<AppStatus>
  sendRendererReady: () => void
  sendCaptureStarted: (atMs: number) => void
  sendCaptureStopped: (summary: RecordingSummary) => void
  sendCaptureFailed: (message: string) => void
  sendPcmBatch: (batch: PcmBatch) => void
  setTheme: (theme: ThemePreference) => Promise<ThemePreference>
  setHotkey: (accelerator: string) => Promise<HotkeySetResult>
  setAsrProvider: (provider: SelectableAsrProviderId) => Promise<AppStatus>
  onState: (listener: (state: AppState, message?: string) => void) => () => void
  onTranscript: (listener: (event: TranscriptEvent) => void) => () => void
  onRecordingCommand: (listener: (command: RecordingCommand) => void) => () => void
  onThemeChanged: (listener: (theme: ThemePreference) => void) => () => void
}
