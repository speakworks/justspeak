import { AUDIO_SAMPLE_RATE } from '../src/core/audio/vad'

export interface SignalPart {
  ms: number
  /** Peak amplitude as a fraction of full scale; RMS equals this for the
   * alternating-sign waveform, which makes threshold tests exact. */
  amplitude: number
}

export function samplesFor(ms: number, sampleRate = AUDIO_SAMPLE_RATE): number {
  return Math.round((ms * sampleRate) / 1000)
}

export function signalPcm(parts: SignalPart[], sampleRate = AUDIO_SAMPLE_RATE): Int16Array {
  const total = parts.reduce((sum, part) => sum + samplesFor(part.ms, sampleRate), 0)
  const pcm = new Int16Array(total)
  let offset = 0
  for (const part of parts) {
    const count = samplesFor(part.ms, sampleRate)
    const peak = Math.round(part.amplitude * 0x7fff)
    for (let i = 0; i < count; i += 1) {
      pcm[offset + i] = i % 2 === 0 ? peak : -peak
    }
    offset += count
  }
  return pcm
}
