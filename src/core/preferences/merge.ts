/**
 * Pure merge rules for `userData/preferences.json`.
 *
 * The file is shared by every preference, so a write must be a merge rather
 * than a replacement: keys owned by other features (or by a newer version of
 * the app) survive. Validation lives here too, so main never persists a value
 * the renderer could never use.
 */

import { parseAccelerator } from '../hotkey/accelerator'
import { isThemePreference } from '../theme/theme'
import type { ThemePreference } from '../../shared/ipc'

/** Everything this module knows how to read from `preferences.json`. */
export interface StoredPreferences {
  theme: ThemePreference
  hotkey: string
}

/** The validated subset a write may apply. */
export interface PreferenceUpdate {
  theme?: ThemePreference
  hotkey?: string
}

export interface RejectedPreference {
  key: string
  reason: string
}

export interface MergeResult {
  /** The object to persist (existing keys plus accepted updates). */
  record: Record<string, unknown>
  accepted: PreferenceUpdate
  rejected: RejectedPreference[]
  /** True only when nothing was rejected; a false result is never written. */
  ok: boolean
}

const WRITABLE_KEYS = new Set(['theme', 'hotkey'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Merge `patch` over `existing`.
 *
 * - Unknown keys already in `existing` (including non-object input) are kept.
 * - Only `theme` and `hotkey` are writable; any other patch key is rejected.
 * - An invalid theme or hotkey rejects the whole patch: nothing is partially
 *   applied, so a typo can never leave the file in a half-updated state.
 */
export function mergePreferences(existing: unknown, patch: unknown): MergeResult {
  const base: Record<string, unknown> = isPlainObject(existing) ? existing : {}
  const rejected: RejectedPreference[] = []
  const accepted: PreferenceUpdate = {}

  if (!isPlainObject(patch)) {
    return {
      record: { ...base },
      accepted,
      rejected: [{ key: '', reason: '设置必须是一个对象。' }],
      ok: false
    }
  }

  for (const key of Object.keys(patch)) {
    if (!WRITABLE_KEYS.has(key)) {
      rejected.push({ key, reason: `未知的设置项「${key}」。` })
    }
  }

  if ('theme' in patch) {
    if (isThemePreference(patch.theme)) {
      accepted.theme = patch.theme
    } else {
      rejected.push({ key: 'theme', reason: '外观值无效，只接受 system、light 或 dark。' })
    }
  }

  if ('hotkey' in patch) {
    const parsed = parseAccelerator(patch.hotkey)
    if (parsed.ok) {
      accepted.hotkey = parsed.value.accelerator
    } else {
      rejected.push({ key: 'hotkey', reason: parsed.error.message })
    }
  }

  // Atomic: one rejected value rejects the patch, so `accepted` is empty and
  // the file keeps every previous value instead of a half-applied mix.
  if (rejected.length > 0) {
    return { record: { ...base }, accepted: {}, rejected, ok: false }
  }
  return { record: { ...base, ...accepted }, accepted, rejected, ok: true }
}

/** True when a merge result actually changes one of the two stored values. */
export function hasAcceptedChange(result: MergeResult): boolean {
  return result.accepted.theme !== undefined || result.accepted.hotkey !== undefined
}
