import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppState,
  AppStatus,
  DiagnosticsExportResult,
  HistoryEntry,
  HotkeyCaptureEndResult,
  HotkeyCaptureStartResult,
  JustSpeakApi,
  LlmDownloadEvent,
  OverlayState,
  PcmBatch,
  PermissionStatus,
  PreferencesPatch,
  PreferencesSetResult,
  PreferencesView,
  RecordingCommand,
  RecordingSummary,
  ResultPanelPayload,
  TranscriptEvent
} from '../shared/ipc'

const api: JustSpeakApi = {
  toggleRecording: () => ipcRenderer.send('recording:toggle'),
  getState: () => ipcRenderer.invoke('state:get') as Promise<AppStatus>,
  sendRendererReady: () => ipcRenderer.send('renderer:ready'),
  sendCaptureStarted: (atMs: number) => ipcRenderer.send('capture:started', atMs),
  sendCaptureStopped: (summary: RecordingSummary) => ipcRenderer.send('capture:stopped', summary),
  sendCaptureFailed: (message: string) => ipcRenderer.send('capture:failed', message),
  sendPcmBatch: (batch: PcmBatch) => ipcRenderer.send('capture:pcm', batch),
  setAsrProvider: (provider) => ipcRenderer.invoke('asr:set-provider', provider) as Promise<AppStatus>,
  getPreferences: () => ipcRenderer.invoke('preferences:get') as Promise<PreferencesView>,
  setPreferences: (patch: PreferencesPatch) =>
    ipcRenderer.invoke('preferences:set', patch) as Promise<PreferencesSetResult>,
  beginHotkeyCapture: () =>
    ipcRenderer.invoke('hotkey:capture-start') as Promise<HotkeyCaptureStartResult>,
  endHotkeyCapture: () =>
    ipcRenderer.invoke('hotkey:capture-end') as Promise<HotkeyCaptureEndResult>,
  onHotkeyCaptureEnded: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, result: HotkeyCaptureEndResult) =>
      listener(result)
    ipcRenderer.on('hotkey:capture-ended', handler)
    return () => ipcRenderer.removeListener('hotkey:capture-ended', handler)
  },
  setLlmKey: (key: string) =>
    ipcRenderer.invoke('llm:set-key', key) as Promise<{ ok: boolean; message?: string }>,
  clearLlmKey: () =>
    ipcRenderer.invoke('llm:clear-key') as Promise<{ ok: boolean; message?: string }>,
  downloadLlmModel: () =>
    ipcRenderer.invoke('llm:download-model') as Promise<{ ok: boolean; message?: string }>,
  onLlmDownload: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, next: LlmDownloadEvent) => listener(next)
    ipcRenderer.on('llm:download', handler)
    return () => ipcRenderer.removeListener('llm:download', handler)
  },
  exportDiagnostics: () =>
    ipcRenderer.invoke('diagnostics:export') as Promise<DiagnosticsExportResult>,
  getPermissions: () => ipcRenderer.invoke('permissions:get') as Promise<PermissionStatus>,
  openAccessibilitySettings: () =>
    ipcRenderer.invoke('permissions:open-accessibility') as Promise<void>,
  onPreferencesChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, preferences: PreferencesView) => {
      listener(preferences)
    }
    ipcRenderer.on('preferences:changed', handler)
    return () => ipcRenderer.removeListener('preferences:changed', handler)
  },
  onOverlayState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: OverlayState) => listener(state)
    ipcRenderer.on('overlay:state', handler)
    return () => ipcRenderer.removeListener('overlay:state', handler)
  },
  onOverlayLevel: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, level: number) => listener(level)
    ipcRenderer.on('overlay:level', handler)
    return () => ipcRenderer.removeListener('overlay:level', handler)
  },
  onOverlayComplete: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on('overlay:complete', handler)
    return () => ipcRenderer.removeListener('overlay:complete', handler)
  },
  overlayReady: () => ipcRenderer.send('overlay:ready'),
  cancelRecording: () => ipcRenderer.send('overlay:cancel'),
  finishRecording: () => ipcRenderer.send('overlay:finish'),
  onPanelText: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ResultPanelPayload) => {
      listener(payload)
    }
    ipcRenderer.on('panel:text', handler)
    return () => ipcRenderer.removeListener('panel:text', handler)
  },
  panelReady: () => ipcRenderer.send('panel:ready'),
  copyPanelText: () => ipcRenderer.send('panel:copy'),
  closeResultPanel: () => ipcRenderer.send('panel:close'),
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, next: AppState, message?: string) => {
      listener(next, message)
    }
    ipcRenderer.on('state', handler)
    return () => ipcRenderer.removeListener('state', handler)
  },
  onTranscript: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: TranscriptEvent) => {
      listener(event)
    }
    ipcRenderer.on('transcript', handler)
    return () => ipcRenderer.removeListener('transcript', handler)
  },
  onTranscriptInsert: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, text: string) => listener(text)
    ipcRenderer.on('transcript:insert', handler)
    return () => ipcRenderer.removeListener('transcript:insert', handler)
  },
  onRecordingCommand: (listener) => {
    const start = (): void => listener('start' satisfies RecordingCommand)
    const stop = (): void => listener('stop' satisfies RecordingCommand)
    ipcRenderer.on('recording:start', start)
    ipcRenderer.on('recording:stop', stop)
    return () => {
      ipcRenderer.removeListener('recording:start', start)
      ipcRenderer.removeListener('recording:stop', stop)
    }
  },
  onMenuNavigate: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, destination: 'settings'): void =>
      listener(destination)
    ipcRenderer.on('menu:navigate', handler)
    return () => ipcRenderer.removeListener('menu:navigate', handler)
  },
  getHistory: () => ipcRenderer.invoke('history:list') as Promise<HistoryEntry[]>,
  deleteHistoryEntry: (id: string) =>
    ipcRenderer.invoke('history:delete', id) as Promise<HistoryEntry[]>,
  getHistoryAudio: (id: string) =>
    ipcRenderer.invoke('history:audio', id) as Promise<ArrayBuffer | null>,
  copyText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text) as Promise<void>,
  onHistoryChanged: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on('history:changed', handler)
    return () => ipcRenderer.removeListener('history:changed', handler)
  }
}

contextBridge.exposeInMainWorld('justspeak', api)
