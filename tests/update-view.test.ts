import { describe, expect, it } from 'vitest'
import type { UpdateStatusView } from '../src/shared/ipc'
import {
  canDownloadAfterEvent,
  canInstallAfterEvent,
  updateFeedbackFromEvent,
  updatePrivacySentence
} from '../src/core/update/update-view'

const STATUS: UpdateStatusView = {
  feedUrl: 'https://github.com/speakworks/justspeak/releases',
  signed: false,
  checking: false
}

describe('the update feedback is the honest event text', () => {
  it('says what a found version offers without claiming anything downloaded', () => {
    const feedback = updateFeedbackFromEvent({ type: 'available', version: '0.2.0' })
    expect(feedback).toEqual({
      text: '发现新版本 0.2.0，是否下载并安装？',
      isError: false
    })
    expect(canDownloadAfterEvent({ type: 'available', version: '0.2.0' })).toBe(true)
    expect(canInstallAfterEvent({ type: 'available', version: '0.2.0' })).toBe(false)
  })

  it('states the unsigned truth instead of pretending to have checked', () => {
    // OpenSpec `app-update`: an unsigned build SHALL NOT pretend to have checked.
    expect(updateFeedbackFromEvent({ type: 'needs-signature' })).toEqual({
      text: '自动更新需要正式签名版。当前构建未签名，更新请前往 Releases 页面下载。',
      isError: false
    })
    expect(canDownloadAfterEvent({ type: 'needs-signature' })).toBe(false)
  })

  it('names the newest state and hides the action once it progresses', () => {
    expect(updateFeedbackFromEvent({ type: 'up-to-date', version: '0.1.0' })?.text).toContain(
      '已是最新版本'
    )
    expect(canDownloadAfterEvent({ type: 'ready-to-install' })).toBe(false)
    expect(canInstallAfterEvent({ type: 'ready-to-install' })).toBe(true)
    expect(canInstallAfterEvent({ type: 'downloading', percent: 40 })).toBe(false)
  })

  it('renders download progress and errors', () => {
    expect(updateFeedbackFromEvent({ type: 'downloading', percent: 45 })?.text).toContain('45%')
    const error = updateFeedbackFromEvent({ type: 'error', message: 'ENOTFOUND' })
    expect(error?.isError).toBe(true)
    expect(error?.text).toContain('ENOTFOUND')
  })

  it('gives nothing while checking (the button already shows 正在检查…)', () => {
    expect(updateFeedbackFromEvent({ type: 'checking' })).toBeNull()
  })
})

describe('the privacy sentence names the fixed feed', () => {
  it('carries the feed URL so the UI and the docs agree', () => {
    expect(updatePrivacySentence(STATUS)).toContain(
      'https://github.com/speakworks/justspeak/releases'
    )
    expect(updatePrivacySentence(null)).toContain('releases')
  })
})
