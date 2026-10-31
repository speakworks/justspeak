import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppState,
  AppStatus,
  JustSpeakApi,
  OverlayState,
  PcmBatch,
  PreferencesPatch,
  PreferencesSetResult,
  PreferencesView,
  RecordingCommand,
  RecordingSummary,
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
  overlayReady: () => ipcRenderer.send('overlay:ready'),
  cancelRecording: () => ipcRenderer.send('overlay:cancel'),
  finishRecording: () => ipcRenderer.send('overlay:finish'),
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
  onRecordingCommand: (listener) => {
    const start = (): void => listener('start' satisfies RecordingCommand)
    const stop = (): void => listener('stop' satisfies RecordingCommand)
    ipcRenderer.on('recording:start', start)
    ipcRenderer.on('recording:stop', stop)
    return () => {
      ipcRenderer.removeListener('recording:start', start)
      ipcRenderer.removeListener('recording:stop', stop)
    }
  }
}

contextBridge.exposeInMainWorld('justspeak', api)
