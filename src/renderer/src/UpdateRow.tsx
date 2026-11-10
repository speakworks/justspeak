import React, { useEffect, useState } from 'react'
import type { UpdateEvent, UpdateStatusView } from '../../shared/ipc'
import {
  canDownloadAfterEvent,
  canInstallAfterEvent,
  updateFeedbackFromEvent,
  updatePrivacySentence
} from '../../core/update/update-view'

/**
 * The settings row for the update client (OpenSpec `app-update`).
 *
 * The row renders main's view, never its own idea of the truth: the toggle
 * reflects the preference, the feedback line is exactly the pushed event's
 * text, and in an unsigned build the honest needs-signature message replaces
 * anything a check would have said.
 */
export function UpdateRow(): React.JSX.Element {
  const [status, setStatus] = useState<UpdateStatusView | null>(null)
  const [autoCheck, setAutoCheck] = useState(false)
  const [event, setEvent] = useState<UpdateEvent | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let disposed = false
    // The toggle's truth lives in preferences.json; the row reads it through
    // the same preferences surface every other row uses.
    void window.justspeak.getPreferences().then((preferences) => {
      if (disposed) return
      setAutoCheck(preferences.updateAutoCheck)
    })
    void window.justspeak.getUpdateStatus().then((view) => {
      if (disposed) return
      setStatus(view)
    })
    const unsubscribe = window.justspeak.onUpdateEvent((pushed) => {
      if (disposed) return
      setEvent(pushed)
      if (pushed.type !== 'checking') setBusy(false)
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const feedback = event ? updateFeedbackFromEvent(event) : null

  const check = (): void => {
    setBusy(true)
    void window.justspeak.checkForUpdate().catch(() => setBusy(false))
  }

  const toggleAuto = (): void => {
    const next = !autoCheck
    setAutoCheck(next)
    void window.justspeak.setUpdateAutoCheck({ enabled: next })
  }

  return (
    <div className="settings-row">
      <div className="settings-row-head">
        <span className="settings-label">更新</span>
      </div>
      <p className="settings-detail">{updatePrivacySentence(status)}</p>
      <div className="settings-control" role="group" aria-label="更新">
        <button type="button" className="hotkey-apply" onClick={check} disabled={busy}>
          {busy ? '正在检查…' : '检查更新'}
        </button>
        <button
          type="button"
          className={autoCheck ? 'theme-option selected' : 'theme-option'}
          aria-pressed={autoCheck}
          onClick={toggleAuto}
        >
          自动检查更新
        </button>
      </div>
      <p className="settings-detail">
        自动检查在应用启动后和之后每 24 小时进行，最多一天一次；发现新版本时先询问，不会自动下载安装。
        {!status?.signed ? '当前构建未签名，自动更新需要正式签名版。' : ''}
      </p>
      {feedback ? (
        <p className={feedback.isError ? 'settings-detail error' : 'settings-detail'}>
          {feedback.text}
        </p>
      ) : null}
      {canDownloadAfterEvent(event) ? (
        <div className="settings-control">
          <button
            type="button"
            className="hotkey-apply"
            onClick={() =>
              void window.justspeak.downloadUpdate().catch((error: unknown) =>
                setEvent({
                  type: 'error',
                  message: error instanceof Error ? error.message : String(error)
                })
              )
            }
          >
            下载并安装
          </button>
        </div>
      ) : null}
      {canInstallAfterEvent(event) ? (
        <div className="settings-control">
          <button
            type="button"
            className="hotkey-apply"
            onClick={() => {
              try {
                window.justspeak.installUpdate()
              } catch (error) {
                setEvent({
                  type: 'error',
                  message: error instanceof Error ? error.message : String(error)
                })
              }
            }}
          >
            立即安装并重启
          </button>
        </div>
      ) : null}
    </div>
  )
}
