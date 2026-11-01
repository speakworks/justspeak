import type { MediaAccessStatus } from '../../shared/ipc'

/**
 * Plain-language permission lines for the first-run screen.
 *
 * Pure so the wording is testable and the UI never invents a promise the app
 * cannot keep: Accessibility is what makes a paste possible, and microphone
 * access is only requested when the first recording actually starts.
 */

export type PermissionTone = 'ok' | 'warn' | 'bad'

export interface PermissionLine {
  tone: PermissionTone
  label: string
  hint: string
}

export function describeAccessibility(granted: boolean): PermissionLine {
  return granted
    ? {
        tone: 'ok',
        label: '已授权',
        hint: '识别结果可以自动粘贴到前台应用。'
      }
    : {
        tone: 'warn',
        label: '未授权',
        hint: '无法自动粘贴；识别完成后会显示复制面板。可在系统设置 → 隐私与安全性 → 辅助功能中允许。'
      }
}

export function describeMicrophone(status: MediaAccessStatus): PermissionLine {
  switch (status) {
    case 'granted':
      return { tone: 'ok', label: '已授权', hint: '录制时不会再询问。' }
    case 'not-determined':
      return {
        tone: 'warn',
        label: '尚未询问',
        hint: '第一次按快捷键录音时，macOS 会询问麦克风权限。'
      }
    case 'denied':
      return {
        tone: 'bad',
        label: '已拒绝',
        hint: '请在系统设置 → 隐私与安全性 → 麦克风中允许 JustSpeak（开发时是 Electron）。'
      }
    case 'restricted':
      return { tone: 'bad', label: '受限制', hint: '系统策略禁止麦克风访问。' }
    default:
      return { tone: 'warn', label: '状态未知', hint: '首次录音时系统会再次确认。' }
  }
}
