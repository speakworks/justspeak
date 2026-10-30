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

/** Why a provider row cannot be changed right now, in the user's words. */
export const PROVIDER_NOT_READY_REASON = 'ASR 尚未就绪，暂时无法切换模型。'
export const PROVIDER_FAKE_REASON = '测试模式下不选择模型。'
export const PROVIDER_HEADER_HINT = '在窗口顶部的模型下拉中切换。'

export interface ProviderLiveState {
  /** The mode main is running, or trying to run. */
  mode: string
  /** True only when an adapter is actually constructed and the session is usable. */
  live: boolean
  /** Label of `mode`, when that mode is a real selectable provider. */
  label?: string
}

/**
 * The provider row's truth, derived from liveness rather than from the mode id.
 * A mode id survives every failure path — a missing model, a bad
 * `JUSTSPEAK_ASR`, an invalid segmentation config — so keying off it alone
 * would promise a switch that the running app cannot deliver.
 */
export function summarizeProvider(state: ProviderLiveState): ProviderSummary {
  if (state.mode === 'fake') {
    return {
      id: 'fake',
      label: state.label ?? 'FAKE ASR（测试模式）',
      selectable: false,
      reason: PROVIDER_FAKE_REASON
    }
  }
  if (!state.live || state.label === undefined) {
    return {
      id: state.mode,
      label: state.label ?? 'ASR 不可用',
      selectable: false,
      reason: PROVIDER_NOT_READY_REASON
    }
  }
  return {
    id: state.mode,
    label: state.label,
    selectable: true,
    reason: PROVIDER_HEADER_HINT
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
