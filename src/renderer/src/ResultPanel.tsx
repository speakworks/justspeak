import React, { useEffect, useState } from 'react'
import { panelHint } from '../../core/panel/hint'
import type { ResultPanelPayload } from '../../shared/ipc'

/**
 * The copy panel for a transcript that could not be pasted.
 *
 * It lives in its own window (`?panel=1`) because it must float over another
 * app without activating JustSpeak. Escape is handled in main (a
 * non-focusable window never receives the key); this component only renders,
 * copies and closes.
 */
export function ResultPanel(): React.JSX.Element {
  const [payload, setPayload] = useState<ResultPanelPayload | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const unsubscribe = window.justspeak.onPanelText((next) => {
      setPayload(next)
      setCopied(false)
      document.documentElement.dataset.theme = next.theme
    })
    // Main retains the payload and pushes it on this signal, which is what
    // makes the first panel after launch show its text.
    window.justspeak.panelReady()
    return unsubscribe
  }, [])

  const copy = (): void => {
    setCopied(true)
    window.justspeak.copyPanelText()
  }

  return (
    <div className="result-panel" role="dialog" aria-label="识别结果">
      <div className="result-panel-head">
        <span className="result-panel-title">焦点不在输入框</span>
        <button
          type="button"
          className="result-panel-close"
          aria-label="关闭"
          onClick={() => window.justspeak.closeResultPanel()}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <p className="result-panel-text">{payload?.text ?? ''}</p>
      <div className="result-panel-foot">
        <span className="result-panel-hint">{panelHint(payload?.canEscape ?? false)}</span>
        <button type="button" className="result-panel-copy" onClick={copy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
    </div>
  )
}
