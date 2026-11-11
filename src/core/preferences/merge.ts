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
import type { LlmBackend, ThemePreference } from '../../shared/ipc'

/** Everything this module knows how to read from `preferences.json`. */
export interface StoredPreferences {
  theme: ThemePreference
  hotkey: string
  llmBackend: LlmBackend
  llmBaseUrl: string
  llmModel: string
  /** 自动检查更新 toggle; `false` is the default and the only first run. */
  updateAutoCheck: boolean
  /** Epoch ms of the last automatic check; `0` means the app never checked. */
  updateLastCheckAtMs: number
}

/** The validated subset a write may apply. */
export interface PreferenceUpdate {
  theme?: ThemePreference
  hotkey?: string
  llmBackend?: LlmBackend
  llmBaseUrl?: string
  llmModel?: string
  updateAutoCheck?: boolean
  updateLastCheckAtMs?: number
}

export function parseLlmBackend(value: unknown): LlmBackend {
  return value === 'local' || value === 'endpoint' ? value : 'off'
}

export function parseLlmBaseUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 500) : ''
}

export function parseLlmModel(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 200) : ''
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

const WRITABLE_KEYS = new Set([
  'theme',
  'hotkey',
  'llmBackend',
  'llmBaseUrl',
  'llmModel',
  'updateAutoCheck',
  'updateLastCheckAtMs'
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Merge `patch` over `existing`.
 *
 * - Unknown keys already in `existing` (including non-object input) are kept.
 * - Only `theme`, `hotkey` and the three LLM settings are writable; any other
 *   patch key is rejected.
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

  if ('llmBackend' in patch) {
    if (patch.llmBackend === 'off' || patch.llmBackend === 'local' || patch.llmBackend === 'endpoint') {
      accepted.llmBackend = patch.llmBackend
    } else {
      rejected.push({ key: 'llmBackend', reason: '智能清理后端无效。' })
    }
  }

  if ('llmBaseUrl' in patch) {
    if (typeof patch.llmBaseUrl !== 'string' || patch.llmBaseUrl.length > 500) {
      rejected.push({ key: 'llmBaseUrl', reason: '服务地址无效。' })
    } else {
      const value = patch.llmBaseUrl.trim()
      if (value !== '' && !/^https?:\/\/[^\s]+$/i.test(value)) {
        rejected.push({ key: 'llmBaseUrl', reason: '服务地址必须以 http:// 或 https:// 开头。' })
      } else {
        accepted.llmBaseUrl = value
      }
    }
  }

  if ('llmModel' in patch) {
    if (typeof patch.llmModel !== 'string' || patch.llmModel.length > 200) {
      rejected.push({ key: 'llmModel', reason: '模型名称无效。' })
    } else {
      accepted.llmModel = patch.llmModel.trim()
    }
  }

  if ('updateAutoCheck' in patch) {
    if (typeof patch.updateAutoCheck === 'boolean') {
      accepted.updateAutoCheck = patch.updateAutoCheck
    } else {
      rejected.push({ key: 'updateAutoCheck', reason: '自动检查更新开关值无效。' })
    }
  }

  if ('updateLastCheckAtMs' in patch) {
    // Written by main alone (the renderer never sends this key); a non-number
    // or a negative value falls back to "never checked".
    if (
      typeof patch.updateLastCheckAtMs === 'number' &&
      Number.isFinite(patch.updateLastCheckAtMs) &&
      patch.updateLastCheckAtMs >= 0
    ) {
      accepted.updateLastCheckAtMs = patch.updateLastCheckAtMs
    } else {
      rejected.push({ key: 'updateLastCheckAtMs', reason: '上次检查时间无效。' })
    }
  }

  // Atomic: one rejected value rejects the patch, so `accepted` is empty and
  // the file keeps every previous value instead of a half-applied mix.
  if (rejected.length > 0) {
    return { record: { ...base }, accepted: {}, rejected, ok: false }
  }
  return { record: { ...base, ...accepted }, accepted, rejected, ok: true }
}

export interface PreferenceSetPlan {
  ok: boolean
  message?: string
  /** Empty unless `ok`: a rejected patch may not apply any part of itself. */
  update: PreferenceUpdate
}

/**
 * The decision `preferences:set` must make before it touches the OS or disk.
 * Kept pure so the "nothing is applied when anything is rejected" rule is
 * testable without an IPC channel.
 */
export function planPreferenceSet(patch: unknown): PreferenceSetPlan {
  const result = mergePreferences({}, patch)
  if (!result.ok) {
    return {
      ok: false,
      message: result.rejected[0]?.reason ?? '设置值无效。',
      update: {}
    }
  }
  return { ok: true, update: result.accepted }
}

/** True when the merge accepted at least one writable value. */
export function hasAcceptedChange(result: MergeResult): boolean {
  return Object.keys(result.accepted).length > 0
}
