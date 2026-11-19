import type { SegmenterOptions } from '../../core/audio/segmenter'
import { resolveVadConfig, type VadConfig } from '../../core/audio/vad'
import type { TranscriptionMode } from '../../core/audio/segmented-provider'
import {
  SEGMENTATION_LABELS,
  type SegmentationPreference
} from '../../core/preferences/segmentation'

export type SegmentationMode = TranscriptionMode

export type SegmentationModeResult =
  | { ok: true; mode: SegmentationMode }
  | { ok: false; message: string }

/**
 * Segmentation defaults to `auto`. Unset and empty mean `auto`; `off` and
 * `single` force the historical one-shot path; `vad` enables the segmented provider. Anything else
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

/**
 * How the effective mode was decided. `envValue` is the raw
 * `JUSTSPEAK_SEGMENTED` text; `message` is the exact sentence the settings
 * surface shows for a takeover or a fallback.
 */
export interface SegmentationResolution {
  effective: SegmentationMode
  source: 'env' | 'preference'
  envValue?: string
  envInvalid?: boolean
  message?: string
}

export function formatEnvTakeoverMessage(value: string): string {
  return `当前由环境变量接管（JUSTSPEAK_SEGMENTED=${value}）`
}

export function formatEnvFallbackMessage(
  value: string,
  preference: SegmentationPreference
): string {
  return `JUSTSPEAK_SEGMENTED 的值无效（${value}），已回退到设置中的「${SEGMENTATION_LABELS[preference]}」。`
}

/**
 * Resolve the effective mode from the preference and the env override.
 *
 * A valid `JUSTSPEAK_SEGMENTED` wins. An invalid value falls back to the saved
 * preference and produces a readable notice — it must never make the ASR
 * session unusable, which was the old fail-closed behaviour. An unset or empty
 * variable leaves the preference in charge.
 */
export function resolveSegmentationMode(
  env: EnvLike,
  preference: SegmentationPreference
): SegmentationResolution {
  const raw = env.JUSTSPEAK_SEGMENTED
  if (raw === undefined || raw === '') {
    return { effective: preference, source: 'preference' }
  }

  const parsed = parseSegmentationMode(raw)
  if (parsed.ok) {
    return {
      effective: parsed.mode,
      source: 'env',
      envValue: raw,
      message: formatEnvTakeoverMessage(raw)
    }
  }

  return {
    effective: preference,
    source: 'preference',
    envValue: raw,
    envInvalid: true,
    message: formatEnvFallbackMessage(raw, preference)
  }
}

export interface SegmentationRebuildInput {
  /** The env/preference resolution for the saved choice. */
  resolved: SegmentationResolution
  /** The mode the running provider was built with. */
  currentMode: SegmentationMode
  /** True while recording, transcribing, or pasting. */
  busy: boolean
  /** True while a provider build is already in flight. */
  initializing: boolean
}

/**
 * Whether saving the 长句听写 preference should rebuild the provider now.
 *
 * Only an idle pipeline with a valid preference in charge can apply
 * immediately. An env takeover owns the mode, a busy pipeline must not be
 * interrupted, and an in-flight build already reads the new preference.
 */
export function shouldRebuildForSegmentation(input: SegmentationRebuildInput): boolean {
  const { resolved, currentMode, busy, initializing } = input
  return (
    resolved.source === 'preference' &&
    resolved.effective !== currentMode &&
    !busy &&
    !initializing
  )
}

export interface SegmentationConfig {
  mode: SegmentationMode
  segmenter: SegmenterOptions
}

export type SegmentationConfigResult =
  | { ok: true; config: SegmentationConfig; resolution: SegmentationResolution }
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
 * Reads the experimental VAD knobs. They are only validated when `auto` or
 * `vad` can run the segmenter, so the one-shot `single` configuration behaves
 * exactly as before. An invalid env *mode* now falls back to `preference`
 * instead of failing the session; invalid knobs still fail closed, because
 * silently running a different VAD configuration would hide a bad setting.
 */
export function parseSegmentationConfig(
  env: EnvLike,
  preference: SegmentationPreference = 'auto'
): SegmentationConfigResult {
  const resolution = resolveSegmentationMode(env, preference)
  if (resolution.effective === 'single') {
    return { ok: true, config: { mode: 'single', segmenter: {} }, resolution }
  }

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
        mode: resolution.effective,
        segmenter: {
          ...vad,
          ...(minSegmentMs !== undefined && { minSegmentMs })
        }
      },
      resolution
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
