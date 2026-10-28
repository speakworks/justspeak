import type { SelectableAsrProviderId } from '../../shared/ipc'

/** `fake` is a test escape hatch; the other two are user-selectable providers. */
export type AsrMode = SelectableAsrProviderId | 'fake'

export type AsrModeResult = { ok: true; mode: AsrMode } | { ok: false; message: string }

export const DEFAULT_ASR_MODE: SelectableAsrProviderId = 'qwen3'

export function isSelectableAsrMode(value: unknown): value is SelectableAsrProviderId {
  return value === 'qwen3' || value === 'sensevoice'
}

const ACCEPTED = 'qwen3（默认）、sensevoice、fake（测试）'

/**
 * Provider selection is explicit: qwen3 is the default, fake is the test
 * escape hatch, and any other value fails closed instead of being coerced.
 */
export function parseAsrMode(value: string | undefined): AsrModeResult {
  const trimmed = value?.trim()
  if (trimmed === undefined || trimmed === '' || trimmed === 'qwen3') {
    return { ok: true, mode: DEFAULT_ASR_MODE }
  }
  if (trimmed === 'sensevoice') return { ok: true, mode: 'sensevoice' }
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
