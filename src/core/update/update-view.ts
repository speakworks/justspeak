/**
 * Pure presentation contract for the settings row's update UI, plus the
 * feedback text renderer. The React component stays thin; every string this
 * row can display and every state transition it can show lives here, so the
 * honesty rule (unsigned builds say so; nothing pretends to have checked) is
 * one testable place.
 */
import type { UpdateEvent, UpdateStatusView } from '../../shared/ipc'

/** What the settings row can say, and why. */
export interface UpdateFeedback {
  text: string
  isError: boolean
}

/** The row's derived state, from the pushed event plus the status view. */
export function updateFeedbackFromEvent(event: UpdateEvent): UpdateFeedback | null {
  switch (event.type) {
    case 'checking':
      return null
    case 'up-to-date':
      return { text: `已是最新版本${event.version ? `（${event.version}）` : ''}。`, isError: false }
    case 'available':
      return { text: `发现新版本 ${event.version}，是否下载并安装？`, isError: false }
    case 'downloading':
      return { text: `正在下载更新… ${event.percent}%`, isError: false }
    case 'ready-to-install':
      return { text: '更新已下载，安装完成后将重启应用。', isError: false }
    case 'needs-signature':
      return { text: '自动更新需要正式签名版。当前构建未签名，更新请前往 Releases 页面下载。', isError: false }
    case 'error':
      return { text: `检查更新失败：${event.message}`, isError: true }
  }
}

/** Whether the 下载并安装 button is offered (only after an `available` event). */
export function canDownloadAfterEvent(event: UpdateEvent | null): boolean {
  return event?.type === 'available'
}

/** Whether the 立即安装 button is offered (only after `ready-to-install`). */
export function canInstallAfterEvent(event: UpdateEvent | null): boolean {
  return event?.type === 'ready-to-install'
}

/** The privacy sentence, built from the fixed feed so docs and UI agree. */
export function updatePrivacySentence(status: UpdateStatusView | null): string {
  const feed = status?.feedUrl ?? 'https://github.com/speakworks/justspeak/releases'
  return `检查更新只会向更新源 ${feed} 发送一次普通页面请求，不包含任何听写内容、录音或设备标识。`
}
