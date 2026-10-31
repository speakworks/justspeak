import type { SegmenterOptions } from '../../core/audio/segmenter'
import { resolveVadConfig, type VadConfig } from '../../core/audio/vad'
import type { TranscriptionMode } from '../../core/audio/segmented-provider'

export type SegmentationMode = TranscriptionMode

export type SegmentationModeResult =
  | { ok: true; mode: SegmentationMode }
  | { ok: false; message: string }

/**
 * Segmentation is opt-in. Unset, empty, `off`, and `single` all keep the
 * existing one-shot path; `vad` enables the segmented provider. Anything else
 * fails closed instead of being coerced, matching the ASR provider selector.
 */
export function parseSegmentationMode(value: string | undefined): SegmentationModeResult {
  // Unset means `auto`: the one-shot path unless the utterance exceeds the
  // provider's own limit. `single` still forces the historical behaviour.
  if (value === undefined || value === '') return { ok: true, mode: 'auto' }
  if (value === 'single' || value === 'off') return { ok: true, mode: 'single' }
  if (value === 'auto') return { ok: true, mode: 'auto' }
  if (value === 'vad' || value === 'on' || value === 'segmented') {
    return { ok: true, mode: 'vad' }
  }
  return {
    ok: false,
    message: `JUSTSPEAK_SEGMENTED 的值不受支持：${value}。可用值：auto（默认，超限才分段）、single 或 vad（强制分段）。`
  }
}

export type EnvLike = Record<string, string | undefined>

export interface SegmentationConfig {
  mode: SegmentationMode
  segmenter: SegmenterOptions
}

export type SegmentationConfigResult =
  | { ok: true; config: SegmentationConfig }
  | { ok: false; message: string }

class ConfigError extends Error {}

function readNumber(env: EnvLike, name: string): number | undefined {
  const raw = env[name]
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new ConfigError(`${name} 必须是数字，当前值：${raw}`)
  }
  return value
}

/**
 * Reads the experimental VAD knobs. They are only validated when `vad` mode is
 * selected, so an unset or single-shot configuration behaves exactly as before.
 */
export function parseSegmentationConfig(env: EnvLike): SegmentationConfigResult {
  const mode = parseSegmentationMode(env.JUSTSPEAK_SEGMENTED)
  if (!mode.ok) return { ok: false, message: mode.message }
  if (mode.mode === 'single') return { ok: true, config: { mode: 'single', segmenter: {} } }

  try {
    const startThreshold = readNumber(env, 'JUSTSPEAK_VAD_START_THRESHOLD')
    const endThreshold = readNumber(env, 'JUSTSPEAK_VAD_END_THRESHOLD')
    const minSpeechMs = readNumber(env, 'JUSTSPEAK_VAD_MIN_SPEECH_MS')
    const minSilenceMs = readNumber(env, 'JUSTSPEAK_VAD_MIN_SILENCE_MS')
    const padMs = readNumber(env, 'JUSTSPEAK_VAD_PAD_MS')
    const frameSamples = readNumber(env, 'JUSTSPEAK_VAD_FRAME_SAMPLES')
    const minSegmentMs = readNumber(env, 'JUSTSPEAK_SEGMENT_MIN_MS')

    if (minSegmentMs !== undefined && minSegmentMs < 0) {
      throw new ConfigError('JUSTSPEAK_SEGMENT_MIN_MS must not be negative')
    }

    const overrides: Partial<VadConfig> = {
      ...(startThreshold !== undefined && { startThreshold }),
      ...(endThreshold !== undefined && { endThreshold }),
      ...(minSpeechMs !== undefined && { minSpeechMs }),
      ...(minSilenceMs !== undefined && { minSilenceMs }),
      ...(padMs !== undefined && { padMs }),
      ...(frameSamples !== undefined && { frameSamples })
    }

    const vad = resolveVadConfig(overrides)
    return {
      ok: true,
      config: {
        // Preserve the requested mode: `auto` and `vad` share the same knobs.
        mode: mode.mode,
        segmenter: {
          ...vad,
          ...(minSegmentMs !== undefined && { minSegmentMs })
        }
      }
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ConfigError
          ? error.message
          : `VAD 配置无效：${error instanceof Error ? error.message : String(error)}`
    }
  }
}
