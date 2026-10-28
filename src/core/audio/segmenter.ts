import {
  AUDIO_SAMPLE_RATE,
  detectSpeechRegions,
  msToSamples,
  resolveVadConfig,
  type SpeechRegion,
  type VadConfig
} from './vad'

/**
 * The session buffer already enforces this bound in the main process. The
 * segmenter repeats it so a caller cannot reach the provider with more audio
 * merely by opting into segmentation.
 */
export const SEGMENTED_MAX_SESSION_SAMPLES = 120 * AUDIO_SAMPLE_RATE

/**
 * A provider must receive an utterance, not a click. Regions below this are
 * merged into a neighbour instead of being dropped, so no speech audio is
 * lost just because the detector found a very short burst.
 */
export const MIN_SEGMENT_MS = 100

export type SegmentationErrorCode = 'AUDIO_TOO_LONG' | 'INVALID_AUDIO' | 'INVALID_CONFIG'

export interface SegmentationError {
  code: SegmentationErrorCode
  message: string
}

export interface SpeechSegment {
  index: number
  startSample: number
  endSample: number
  pcm: Int16Array
}

export type SegmentationResult =
  | { ok: true; segments: SpeechSegment[] }
  | { ok: false; error: SegmentationError }

export interface SegmenterOptions extends Partial<VadConfig> {
  minSegmentMs?: number
  maxSessionSamples?: number
}

function mergeShortRegions(
  regions: SpeechRegion[],
  minSamples: number,
  totalSamples: number
): SpeechRegion[] {
  if (regions.length === 0) return []
  const merged: SpeechRegion[] = []
  for (const region of regions) {
    const previous = merged[merged.length - 1]
    if (previous && previous.endSample - previous.startSample < minSamples) {
      // Keep the silence between the two spans: dropping it would also drop
      // the quiet part of the short utterance that made it worth keeping.
      merged[merged.length - 1] = {
        startSample: previous.startSample,
        endSample: region.endSample
      }
    } else {
      merged.push({ ...region })
    }
  }

  const last = merged[merged.length - 1]
  if (last.endSample - last.startSample < minSamples) {
    if (merged.length > 1) {
      const previous = merged[merged.length - 2]
      merged.splice(merged.length - 2, 2, {
        startSample: previous.startSample,
        endSample: last.endSample
      })
    } else {
      // Only one very short region exists: widen it with surrounding silence
      // rather than returning a segment below the minimum or dropping it. A
      // clip shorter than the minimum can only yield the whole clip.
      const deficit = minSamples - (last.endSample - last.startSample)
      const before = Math.min(Math.floor(deficit / 2), last.startSample)
      const after = Math.min(deficit - before, totalSamples - last.endSample)
      merged[0] = {
        startSample: last.startSample - before,
        endSample: last.endSample + after
      }
    }
  }

  return merged
}

/**
 * Converts PCM into provider-sized speech segments in utterance order.
 * Leading/trailing silence and the silence between utterances are trimmed;
 * every sample inside a returned span is kept. The input is never truncated:
 * audio over the session bound is a typed error.
 */
export function segmentPcm(
  pcm: Int16Array,
  options: SegmenterOptions = {}
): SegmentationResult {
  if (!(pcm instanceof Int16Array)) {
    return {
      ok: false,
      error: { code: 'INVALID_AUDIO', message: 'Audio must be 16-bit PCM samples' }
    }
  }

  const {
    minSegmentMs = MIN_SEGMENT_MS,
    maxSessionSamples = SEGMENTED_MAX_SESSION_SAMPLES,
    ...vadOverrides
  } = options

  if (pcm.length > maxSessionSamples) {
    return {
      ok: false,
      error: {
        code: 'AUDIO_TOO_LONG',
        message: `Audio has ${pcm.length} samples; the session limit is ${maxSessionSamples}`
      }
    }
  }

  let config: VadConfig
  try {
    config = resolveVadConfig(vadOverrides)
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CONFIG',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  if (!Number.isFinite(minSegmentMs) || minSegmentMs < 0) {
    return {
      ok: false,
      error: { code: 'INVALID_CONFIG', message: 'minSegmentMs must be a non-negative number' }
    }
  }

  const regions = detectSpeechRegions(pcm, config)
  const minSegmentSamples = msToSamples(minSegmentMs, config.sampleRate)
  const merged = mergeShortRegions(regions, minSegmentSamples, pcm.length)

  return {
    ok: true,
    segments: merged.map((region, index) => ({
      index,
      startSample: region.startSample,
      endSample: region.endSample,
      pcm: pcm.slice(region.startSample, region.endSample)
    }))
  }
}
