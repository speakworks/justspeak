import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppState,
  AppStatus,
  JustSpeakApi,
  PcmBatch,
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
