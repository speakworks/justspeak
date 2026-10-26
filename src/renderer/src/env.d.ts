import type { JustSpeakApi } from '../../shared/ipc'

declare global {
  interface Window {
    justspeak: JustSpeakApi
  }
}

export {}
