/**
 * Pure presentation rules for the settings panel.
 *
 * The renderer must not guess whether a preference is the default, a user
 * override, or unavailable: main reports raw values, and these functions turn
 * them into one honest label plus a reason. Keeping the decision here makes it
 * testable without a DOM.
 */

import { DEFAULT_ACCELERATOR } from '../hotkey/accelerator'
import { DEFAULT_UNDO_WINDOW_MINUTES } from '../injection/undo'
import { THEME_LABEL } from '../theme/theme'
import {
  LOGIN_ITEM_REQUIRES_APPROVAL_REASON,
  LOGIN_ITEM_UNAVAILABLE_REASON
} from './autostart'
import type {
  LoginItemView,
  PreferencesView,
  ProviderSummary,
  ThemePreference,
  VocabularySummary
} from '../../shared/ipc'

export type SettingStatus = 'default' | 'override' | 'unavailable' | 'pending'

export interface SettingState {
  status: SettingStatus
  /** Short chip text: 默认 / 已修改 / 不可用 / 待允许 / 未生效. */
  statusLabel: string
  /** One line explaining the current value or what is missing. */
  detail: string
}

const STATUS_LABEL: Record<SettingStatus, string> = {
  default: '默认',
  override: '已修改',
  unavailable: '不可用',
  pending: '未生效'
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

/**
 * The 开机自动启动 row. The value is the OS's answer, so an external change in
 * 系统设置 → 通用 → 登录项 shows up as off; the built-in default is on, which
 * makes an enabled login item `default` and a disabled one an `override`.
 */
export function describeAutostart(loginItem: LoginItemView): SettingState {
  if (!loginItem.available) {
    return {
      status: 'unavailable',
      statusLabel: STATUS_LABEL.unavailable,
      detail: loginItem.message ?? LOGIN_ITEM_UNAVAILABLE_REASON
    }
  }
  if (loginItem.status === 'requires-approval') {
    // A real intermediate macOS state, not a failed registration.
    return {
      status: 'pending',
      statusLabel: '待允许',
      detail: LOGIN_ITEM_REQUIRES_APPROVAL_REASON
    }
  }
  if (loginItem.message) {
    // The API works but this change did not take effect; the switch stays
    // clickable so the user can retry, and the chip must not claim success.
    return {
      status: 'pending',
      statusLabel: STATUS_LABEL.pending,
      detail: loginItem.message
    }
  }
  if (loginItem.openAtLogin) {
    return {
      status: 'default',
      statusLabel: STATUS_LABEL.default,
      detail: '登录时自动启动。'
    }
  }
  return {
    status: 'override',
    statusLabel: STATUS_LABEL.override,
    detail: '已关闭；可在系统设置 → 通用 → 登录项中重新开启。'
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

/**
 * Whether decode-time terms apply. The live provider's own capability wins;
 * while no provider is live (startup, or after a provider error) fall back to
 * the selected provider's static capability instead of reporting "unsupported".
 */
export function resolveProviderSupportsTerms(
  live: { vocabularyBias: boolean } | undefined,
  selected: { vocabularyBias: boolean } | undefined
): boolean {
  return (live ?? selected)?.vocabularyBias ?? false
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
  const counts = `术语 ${vocabulary.termCount} 条 / 替换 ${vocabulary.replaceCount} 条 / 保护 ${vocabulary.protectCount} 条`
  const notes: string[] = []
  if (vocabulary.droppedTermCount > 0) {
    // Count only; the discarded term strings are never shown.
    notes.push(`${vocabulary.droppedTermCount} 条术语因含英文逗号被忽略。`)
  }
  if (vocabulary.droppedByCapCount > 0) {
    // A file above the decode-time cap keeps only its first 32 terms; say so
    // instead of letting the missing tail look like a silent edit.
    notes.push(`${vocabulary.droppedByCapCount} 条超出 32 条上限未写入。`)
  }
  if (vocabulary.termCount > 0 && !vocabulary.providerSupportsTerms) {
    notes.push('当前 ASR 模型不支持解码期术语偏置，术语未生效。')
  }
  return {
    status: 'override',
    statusLabel: STATUS_LABEL.override,
    detail: [`已加载 ${counts}。`, ...notes].join(' ')
  }
}

/**
 * The starter-load result line. A non-zero overflow states plainly that the
 * missing entries were not written, so the surface cannot imply 已全部载入.
 */
export function describeStarterLoadOverflow(excludedByCap: number): string | undefined {
  if (excludedByCap <= 0) return undefined
  return `${excludedByCap} 条起始词因超出 32 条上限未写入，请先删除部分词条。`
}

/** Why a provider row cannot be changed right now, in the user's words. */
export const PROVIDER_NOT_READY_REASON = 'ASR 尚未就绪，暂时无法切换模型。'
export const PROVIDER_FAKE_REASON = '测试模式下不选择模型。'
export const PROVIDER_SETTINGS_HINT = '在上方下拉中选择模型。'

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
    reason: PROVIDER_SETTINGS_HINT
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

export function describeLlm(preferences: PreferencesView['llm']): SettingState {
  if (preferences.backend === 'off') {
    return { status: 'default', statusLabel: STATUS_LABEL.default, detail: '关闭。' }
  }
  if (preferences.backend === 'local') {
    const filesReady = preferences.local.runtimeReady && preferences.local.modelReady
    // Files existing is not the same as the sidecar running: a crash must not
    // keep the row claiming the local model is ready.
    const ready = filesReady && preferences.local.state !== 'failed'
    return {
      status: ready ? 'override' : 'unavailable',
      statusLabel: ready ? STATUS_LABEL.override : STATUS_LABEL.unavailable,
      detail:
        preferences.message ??
        (ready ? `本地模型 ${preferences.local.modelName}。` : '本地模型不可用。')
    }
  }
  return {
    status:
      preferences.endpoint.baseUrl && preferences.endpoint.model
        ? 'override'
        : 'unavailable',
    statusLabel:
      preferences.endpoint.baseUrl && preferences.endpoint.model
        ? STATUS_LABEL.override
        : STATUS_LABEL.unavailable,
    detail: preferences.message ?? 'OpenAI 兼容端点。'
  }
}

/** Every row the panel renders, derived from one main-owned view. */
export interface SettingsRows {
  theme: SettingState
  hotkey: SettingState
  autostart: SettingState
  undoWindow: SettingState
  vocabulary: SettingState
  provider: SettingState
  llm: SettingState
}

/** 撤销时间窗: 5 minutes is the shipped default, anything else is a choice. */
export function describeUndoWindow(minutes: number): SettingState {
  const safe = Number.isInteger(minutes) && minutes >= 1 ? minutes : DEFAULT_UNDO_WINDOW_MINUTES
  return {
    status: safe === DEFAULT_UNDO_WINDOW_MINUTES ? 'default' : 'override',
    statusLabel: safe === DEFAULT_UNDO_WINDOW_MINUTES ? STATUS_LABEL.default : STATUS_LABEL.override,
    detail: `最近一次插入后 ${safe} 分钟内可撤销或重说。`
  }
}

export function buildSettingsRows(preferences: PreferencesView): SettingsRows {
  return {
    theme: describeTheme(preferences.theme),
    hotkey: describeHotkey(preferences.hotkey, preferences.hotkeyMessage),
    autostart: describeAutostart(preferences.loginItem),
    undoWindow: describeUndoWindow(preferences.undoWindowMinutes),
    vocabulary: describeVocabulary(preferences.vocabulary),
    provider: describeProvider(preferences.provider),
    llm: describeLlm(preferences.llm)
  }
}

