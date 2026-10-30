/**
 * Pure presentation rules for the settings panel.
 *
 * The renderer must not guess whether a preference is the default, a user
 * override, or unavailable: main reports raw values, and these functions turn
 * them into one honest label plus a reason. Keeping the decision here makes it
 * testable without a DOM.
 */

import { parseAccelerator, DEFAULT_ACCELERATOR } from '../hotkey/accelerator'
import { THEME_LABEL } from '../theme/theme'
import type {
  PreferencesView,
  ProviderSummary,
  ThemePreference,
  VocabularySummary
} from '../../shared/ipc'

export type SettingStatus = 'default' | 'override' | 'unavailable'

export interface SettingState {
  status: SettingStatus
  /** Short chip text: 默认 / 已修改 / 不可用. */
  statusLabel: string
  /** One line explaining the current value or what is missing. */
  detail: string
}

const STATUS_LABEL: Record<SettingStatus, string> = {
  default: '默认',
  override: '已修改',
  unavailable: '不可用'
}

export function describeTheme(theme: ThemePreference): SettingState {
  if (theme === 'system') {
    return { status: 'default', statusLabel: STATUS_LABEL.default, detail: '跟随系统外观。' }
  }
  return {
    status: 'override',
    statusLabel: STATUS_LABEL.override,
    detail: `固定为${THEME_LABEL[theme]}。`
  }
}

export function describeHotkey(hotkey: string, message?: string): SettingState {
  if (hotkey.length === 0) {
    return {
      status: 'unavailable',
      statusLabel: STATUS_LABEL.unavailable,
      detail: message ?? '系统没有接受任何全局快捷键。'
    }
  }
  if (message) {
    // The requested binding was refused; the fallback is live and named.
    return { status: 'unavailable', statusLabel: STATUS_LABEL.unavailable, detail: message }
  }
  if (hotkey === DEFAULT_ACCELERATOR) {
    return {
      status: 'default',
      statusLabel: STATUS_LABEL.default,
      detail: `内置快捷键 ${DEFAULT_ACCELERATOR}。`
    }
  }
  return {
    status: 'override',
    statusLabel: STATUS_LABEL.override,
    detail: `已绑定 ${hotkey}。`
  }
}

export function describeVocabulary(vocabulary: VocabularySummary): SettingState {
  if (vocabulary.state === 'unreadable') {
    return {
      status: 'unavailable',
      statusLabel: STATUS_LABEL.unavailable,
      detail: vocabulary.message ?? '词汇表文件无法读取。'
    }
  }
  if (vocabulary.state === 'default') {
    return {
      status: 'default',
      statusLabel: STATUS_LABEL.default,
      detail: '尚未创建词汇表文件，使用内置规则。'
    }
  }
  return {
    status: 'override',
    statusLabel: STATUS_LABEL.override,
    detail: `已加载 ${vocabulary.replaceCount} 条替换、${vocabulary.protectCount} 个保护词。`
  }
}

export function describeProvider(provider: ProviderSummary): SettingState {
  const reason = provider.reason.trim() || '暂不支持更改。'
  if (!provider.selectable) {
    return {
      status: 'unavailable',
      statusLabel: STATUS_LABEL.unavailable,
      detail: `当前：${provider.label}。${reason}`
    }
  }
  return {
    status: 'default',
    statusLabel: STATUS_LABEL.default,
    detail: `当前：${provider.label}。${reason}`
  }
}

/** Every row the panel renders, derived from one main-owned view. */
export interface SettingsRows {
  theme: SettingState
  hotkey: SettingState
  vocabulary: SettingState
  provider: SettingState
}

export function buildSettingsRows(preferences: PreferencesView): SettingsRows {
  return {
    theme: describeTheme(preferences.theme),
    hotkey: describeHotkey(preferences.hotkey, preferences.hotkeyMessage),
    vocabulary: describeVocabulary(preferences.vocabulary),
    provider: describeProvider(preferences.provider)
  }
}

export interface HotkeyDraftResult {
  ok: boolean
  accelerator?: string
  message?: string
  /** True only for a valid binding that differs from the live one. */
  dirty: boolean
}

export function validateHotkeyDraft(draft: string, active: string): HotkeyDraftResult {
  const parsed = parseAccelerator(draft)
  if (!parsed.ok) {
    return { ok: false, message: parsed.error.message, dirty: false }
  }
  return {
    ok: true,
    accelerator: parsed.value.accelerator,
    dirty: parsed.value.accelerator !== active
  }
}
