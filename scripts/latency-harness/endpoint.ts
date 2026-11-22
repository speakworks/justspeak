/**
 * Offline endpointing latency from a recording, with no microphone involved.
 *
 * `detectSpeechRegions` in `src/core/audio/vad.ts` answers "where is speech",
 * then pads both edges for the ASR. That padding is exactly the wrong thing to
 * measure: it hides how long the detector takes to *confirm* an endpoint. This
 * module walks the same windows and keeps the un-padded quiet-run start, so the
 * endpoint column in the Phase 0 table is the app's own structural delay
 * (hysteresis tail + `minSilenceMs`), not a round number taken from the config.
 *
 * It is deliberately a floor for the real product: the true stop instant is
 * somewhere inside the last energetic frame, and no offline pass can know where.
 * The protocol asks the operator to note that in the table instead of guessing.
 */
import {
  DEFAULT_VAD_CONFIG,
  type VadConfig,
  msToSamples,
  resolveVadConfig
} from '../../src/core/audio/vad'

export interface EndpointMeasurement {
  status: 'measured'
  /** User's last frame above the start threshold → VAD confirmed the endpoint. */
  endpointMs: number
  lastSpeechFrameMs: number
  confirmedMs: number
  /** Frames that stayed above `endThreshold` but below `startThreshold`. */
  hysteresisMs: number
  silenceMs: number
  regions: number
}

export interface EndpointBlocked {
  status: 'blocked'
  reason: string
}

export type EndpointOutcome = EndpointMeasurement | EndpointBlocked

function frameRms(pcm: Int16Array, start: number, end: number): number {
  let sum = 0
  for (let i = start; i < end; i += 1) {
    const sample = pcm[i] / 0x8000
    sum += sample * sample
  }
  return Math.sqrt(sum / (end - start))
}

interface ConfirmedRegion {
  lastLoudEndSample: number
  quietRunStart: number
  confirmedSample: number
}

/**
 * Returns the last endpoint the detector confirmed inside the clip. A clip that
 * ends mid-speech has no confirmed endpoint: streaming would still be waiting,
 * so reporting a number there would be an estimate in disguise.
 */
export function measureEndpoint(pcm: Int16Array, overrides: Partial<VadConfig> = {}): EndpointOutcome {
  const config = resolveVadConfig(overrides)
  if (pcm.length === 0) return { status: 'blocked', reason: '音频为空，无法测量端点' }

  const minSilenceSamples = msToSamples(config.minSilenceMs, config.sampleRate)
  const minSpeechSamples = msToSamples(config.minSpeechMs, config.sampleRate)
  const msPerSample = 1000 / config.sampleRate

  const confirmed: ConfirmedRegion[] = []
  let openStart = -1
  let quietRunStart = -1
  let lastLoudEnd = -1

  for (let frameStart = 0; frameStart < pcm.length; frameStart += config.frameSamples) {
    const frameEnd = Math.min(frameStart + config.frameSamples, pcm.length)
    const level = frameRms(pcm, frameStart, frameEnd)

    if (openStart < 0) {
      if (level >= config.startThreshold) {
        openStart = frameStart
        quietRunStart = -1
        lastLoudEnd = frameEnd
      }
      continue
    }

    if (level >= config.endThreshold) {
      quietRunStart = -1
      if (level >= config.startThreshold) lastLoudEnd = frameEnd
      continue
    }
    if (quietRunStart < 0) quietRunStart = frameStart
    if (frameEnd - quietRunStart >= minSilenceSamples) {
      const speechSamples = quietRunStart - openStart
      if (speechSamples >= minSpeechSamples) {
        confirmed.push({ lastLoudEndSample: lastLoudEnd, quietRunStart, confirmedSample: frameEnd })
      }
      openStart = -1
      quietRunStart = -1
      lastLoudEnd = -1
    }
  }

  if (openStart >= 0) {
    return {
      status: 'blocked',
      reason: `素材以语音结尾：VAD 未收到 ${config.minSilenceMs} ms 静音，端点无法确认（流式路径会一直等待）`
    }
  }
  if (confirmed.length === 0) {
    return {
      status: 'blocked',
      reason: `未检测到可确认的语音区间（起始阈值 ${config.startThreshold}，最短语音 ${config.minSpeechMs} ms）`
    }
  }

  const last = confirmed[confirmed.length - 1]
  return {
    status: 'measured',
    endpointMs: round((last.confirmedSample - last.lastLoudEndSample) * msPerSample),
    lastSpeechFrameMs: round(last.lastLoudEndSample * msPerSample),
    confirmedMs: round(last.confirmedSample * msPerSample),
    hysteresisMs: round((last.quietRunStart - last.lastLoudEndSample) * msPerSample),
    silenceMs: round((last.confirmedSample - last.quietRunStart) * msPerSample),
    regions: confirmed.length
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** The live config, exposed so the report can state which thresholds produced a number. */
export const ENDPOINT_CONFIG_SUMMARY = {
  startThreshold: DEFAULT_VAD_CONFIG.startThreshold,
  endThreshold: DEFAULT_VAD_CONFIG.endThreshold,
  minSpeechMs: DEFAULT_VAD_CONFIG.minSpeechMs,
  minSilenceMs: DEFAULT_VAD_CONFIG.minSilenceMs,
  frameSamples: DEFAULT_VAD_CONFIG.frameSamples
}
