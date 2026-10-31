import {
  SELECTABLE_ASR_PROVIDER_IDS,
  type SelectableAsrProviderId
} from '../../shared/ipc'

/** `fake` is a test escape hatch; the other two are user-selectable providers. */
export type AsrMode = SelectableAsrProviderId | 'fake'

export type AsrModeResult = { ok: true; mode: AsrMode } | { ok: false; message: string }

/**
 * SenseVoice Small is the default: the owner's hands-on comparison found it more
 * accurate on real dictation, and it is a third of the download. Its 30-second
 * ceiling is covered by the default `auto` segmentation mode, which keeps the
 * one-shot path for anything that fits and segments only what does not.
 */
export const DEFAULT_ASR_MODE: SelectableAsrProviderId = 'sensevoice'

export function isSelectableAsrMode(value: unknown): value is SelectableAsrProviderId {
  return (
    typeof value === 'string' &&
    (SELECTABLE_ASR_PROVIDER_IDS as readonly string[]).includes(value)
  )
}

const ACCEPTED = 'sensevoice（默认）、qwen3、fake（测试）'

/**
 * Provider selection is explicit. An unset value takes the default; a value the
 * user actually wrote is honoured as written — `qwen3` must stay `qwen3` even
 * though it is no longer the default, or an explicit override would be silently
 * replaced. `fake` stays the test escape hatch, everything else fails closed.
 */
export function parseAsrMode(value: string | undefined): AsrModeResult {
  const trimmed = value?.trim()
  if (trimmed === undefined || trimmed === '') {
    return { ok: true, mode: DEFAULT_ASR_MODE }
  }
  if (isSelectableAsrMode(trimmed)) return { ok: true, mode: trimmed }
  if (trimmed === 'fake') return { ok: true, mode: 'fake' }
  return {
    ok: false,
    message: `JUSTSPEAK_ASR 的值不受支持：${value}。可用值：${ACCEPTED}。`
  }
}

/**
 * Fake output is only reachable from an explicit test environment variable;
 * persisting it as a user preference would show demo text as a real transcript.
 */
export function parseAsrPreference(value: string): AsrModeResult {
  const parsed = parseAsrMode(value)
  if (parsed.ok && parsed.mode === 'fake') {
    return {
      ok: false,
      message: `ASR 偏好不支持 fake（仅测试环境变量可启用）。可用值：qwen3（默认）或 sensevoice。`
    }
  }
  return parsed
}

export interface AsrSelectionInput {
  env?: string
  preference?: string
}

/**
 * An explicit environment variable wins over the persisted preference; an
 * unset preference falls back to qwen3. Unknown values fail visibly.
 */
export function resolveAsrMode(input: AsrSelectionInput): AsrModeResult {
  const env = input.env?.trim()
  if (env) return parseAsrMode(env)
  const preference = input.preference?.trim()
  if (preference) return parseAsrPreference(preference)
  return { ok: true, mode: DEFAULT_ASR_MODE }
}
