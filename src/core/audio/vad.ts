/**
 * Energy-based voice activity detection over 16 kHz mono PCM16.
 *
 * Pure: no Electron, DOM, filesystem, or timers. The detector only answers
 * "where is speech" so the segmenter and the opt-in segmented provider can
 * decide what to send to the ASR. It is not a streaming endpointing signal.
 */

export const AUDIO_SAMPLE_RATE = 16000

export interface VadConfig {
  sampleRate: number
  /** Analysis window in samples; 320 = 20 ms, matching the capture batch. */
  frameSamples: number
  /** Normalized RMS (0..1) that opens a speech region. */
  startThreshold: number
  /** Lower normalized RMS that may close a speech region after minSilenceMs. */
  endThreshold: number
  minSpeechMs: number
  minSilenceMs: number
  /** Silence kept around a region so ASR does not lose the first/last phoneme. */
  padMs: number
}

/**
 * Thresholds are normalized RMS, so they do not scale with device gain. A
 * 0.02 start is roughly -34 dBFS, loud enough to ignore room tone but low
 * enough for a quiet built-in mic; 0.008 gives a 2.5x hysteresis band so a
 * fading word tail does not chatter the region open and closed. 250 ms
 * minimum speech rejects clicks and single-frame noise, and 400 ms minimum
 * silence matches AUDIO-PIPELINE's trailing-silence target while keeping short
 * intra-sentence pauses inside one segment. These are starting values, not
 * measured truth: they need tuning against real dictation before the
 * segmented path can become the default.
 */
export const DEFAULT_VAD_CONFIG: VadConfig = {
  sampleRate: AUDIO_SAMPLE_RATE,
  frameSamples: 320,
  startThreshold: 0.02,
  endThreshold: 0.008,
  minSpeechMs: 250,
  minSilenceMs: 400,
  padMs: 200
}

export interface SpeechRegion {
  startSample: number
  endSample: number
}

export function msToSamples(ms: number, sampleRate: number): number {
  return Math.round((ms * sampleRate) / 1000)
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number`)
}

/**
 * Merges overrides over the defaults and rejects configurations that would
 * make the hysteresis or the windows meaningless.
 */
export function resolveVadConfig(overrides: Partial<VadConfig> = {}): VadConfig {
  const config = { ...DEFAULT_VAD_CONFIG, ...overrides }
  if (!Number.isInteger(config.sampleRate) || config.sampleRate <= 0) {
    throw new RangeError('sampleRate must be a positive integer')
  }
  if (!Number.isInteger(config.frameSamples) || config.frameSamples <= 0) {
    throw new RangeError('frameSamples must be a positive integer')
  }
  assertFinite(config.startThreshold, 'startThreshold')
  assertFinite(config.endThreshold, 'endThreshold')
  if (config.startThreshold <= 0 || config.startThreshold > 1) {
    throw new RangeError('startThreshold must be in (0, 1]')
  }
  if (config.endThreshold <= 0 || config.endThreshold >= config.startThreshold) {
    throw new RangeError('endThreshold must be in (0, startThreshold)')
  }
  for (const [name, value] of [
    ['minSpeechMs', config.minSpeechMs],
    ['padMs', config.padMs]
  ] as const) {
    assertFinite(value, name)
    if (value < 0) throw new RangeError(`${name} must not be negative`)
  }
  assertFinite(config.minSilenceMs, 'minSilenceMs')
  if (config.minSilenceMs <= 0) throw new RangeError('minSilenceMs must be positive')
  return config
}

function frameRms(pcm: Int16Array, start: number, end: number): number {
  let sum = 0
  for (let i = start; i < end; i += 1) {
    const sample = pcm[i] / 0x8000
    sum += sample * sample
  }
  return Math.sqrt(sum / (end - start))
}

/**
 * Returns speech regions in sample order. A region opens only above
 * `startThreshold`, stays open while frames remain above the lower
 * `endThreshold`, and closes after `minSilenceMs` of frames below it. Regions
 * shorter than `minSpeechMs` are discarded; surviving regions are padded by at
 * most half of each neighbouring gap so the result is never overlapping.
 */
export function detectSpeechRegions(
  pcm: Int16Array,
  overrides: Partial<VadConfig> = {}
): SpeechRegion[] {
  const config = resolveVadConfig(overrides)
  if (pcm.length === 0) return []

  const minSpeechSamples = msToSamples(config.minSpeechMs, config.sampleRate)
  const minSilenceSamples = msToSamples(config.minSilenceMs, config.sampleRate)
  const padSamples = msToSamples(config.padMs, config.sampleRate)

  const raw: SpeechRegion[] = []
  let openStart = -1
  let quietRunStart = -1

  for (let frameStart = 0; frameStart < pcm.length; frameStart += config.frameSamples) {
    const frameEnd = Math.min(frameStart + config.frameSamples, pcm.length)
    const level = frameRms(pcm, frameStart, frameEnd)

    if (openStart < 0) {
      if (level >= config.startThreshold) {
        openStart = frameStart
        quietRunStart = -1
      }
      continue
    }

    if (level >= config.endThreshold) {
      quietRunStart = -1
      continue
    }
    if (quietRunStart < 0) quietRunStart = frameStart
    if (frameEnd - quietRunStart >= minSilenceSamples) {
      raw.push({ startSample: openStart, endSample: quietRunStart })
      openStart = -1
      quietRunStart = -1
    }
  }

  if (openStart >= 0) {
    // Endpoint was not confirmed before the clip ended; trim the unconfirmed
    // quiet tail but keep every frame that was speech or still in hysteresis.
    raw.push({
      startSample: openStart,
      endSample: quietRunStart >= 0 ? quietRunStart : pcm.length
    })
  }

  const speech = raw.filter(
    (region) => region.endSample - region.startSample >= minSpeechSamples
  )

  return speech.map((region, index) => {
    const previous = speech[index - 1]
    const next = speech[index + 1]
    const startPad = previous
      ? Math.min(padSamples, Math.floor((region.startSample - previous.endSample) / 2))
      : Math.min(padSamples, region.startSample)
    const endPad = next
      ? Math.min(padSamples, Math.floor((next.startSample - region.endSample) / 2))
      : Math.min(padSamples, pcm.length - region.endSample)
    return {
      startSample: region.startSample - startPad,
      endSample: region.endSample + endPad
    }
  })
}
