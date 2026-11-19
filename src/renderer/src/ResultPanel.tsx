import React, { useCallback, useEffect, useRef, useState } from 'react'
import { panelHint } from '../../core/panel/hint'
import { formatSegmentLine } from '../../core/panel/segments'
import type { ResultPanelPayload } from '../../shared/ipc'

/**
 * The correction panel: a transcript that could not be pasted, shown as a
 * controlled editable field.
 *
 * It lives in its own window (`?panel=1`) because it must float over another
 * app without activating JustSpeak when it first appears. Escape is handled in
 * main (the key is registered globally); this component owns the draft, the
 * reinsertion action, and the guarded undo entry point.
 */
export function ResultPanel(): React.JSX.Element {
  const [payload, setPayload] = useState<ResultPanelPayload | null>(null)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [feedback, setFeedback] = useState<string | undefined>()
  const [undoAvailable, setUndoAvailable] = useState(false)
  /** Only a fresh show replaces the user's edit. */
  const lastRevisionRef = useRef<number | null>(null)

  const refreshUndo = useCallback((): void => {
    void window.justspeak
      .getUndoState()
      .then((state) => setUndoAvailable(state.available))
      .catch(() => setUndoAvailable(false))
  }, [])

  useEffect(() => {
    refreshUndo()
    return window.justspeak.onUndoChanged(refreshUndo)
  }, [refreshUndo])

  useEffect(() => {
    const unsubscribe = window.justspeak.onPanelText((next) => {
      setPayload(next)
      if (next.revision !== lastRevisionRef.current) {
        lastRevisionRef.current = next.revision
        setCopied(false)
        setFeedback(undefined)
        setDraft(next.text)
      }
      document.documentElement.dataset.theme = next.theme
    })
    // Main retains the payload and pushes it on this signal, which is what
    // makes the first panel after launch show its text.
    window.justspeak.panelReady()
    return unsubscribe
  }, [])

  const copy = (): void => {
    setCopied(true)
    window.justspeak.copyPanelText(draft)
  }

  const reinsert = (): void => {
    setFeedback(undefined)
    void window.justspeak
      .reinsertPanelText(draft)
      .then((result) => {
        // A successful insertion hides the panel; only a refusal or the copy
        // fallback needs a line here.
        if (!result.inserted) setFeedback(result.message)
      })
      .catch((error: unknown) => {
        setFeedback(error instanceof Error ? error.message : String(error))
      })
  }

  const undo = (): void => {
    setFeedback(undefined)
    void window.justspeak
      .undoPanelInjection()
      .then((result) => {
        if (result.ok) setFeedback('已撤销上一次插入。')
        else setFeedback(result.message)
      })
      .catch((error: unknown) => {
        setFeedback(error instanceof Error ? error.message : String(error))
      })
      .finally(refreshUndo)
  }

  const text = draft
  const segmentLine = formatSegmentLine(payload?.segments)
  return (
    <div className="result-panel" role="dialog" aria-label="识别结果">
      <div className="result-panel-head">
        <span className="result-panel-title">{payload?.title ?? '焦点不在输入框'}</span>
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
      {payload?.notice ? <p className="result-panel-notice">{payload.notice}</p> : null}
      {segmentLine ? <p className="result-panel-segments">{segmentLine}</p> : null}
      {feedback ? (
        <p className="result-panel-notice" role="status" aria-live="polite">
          {feedback}
        </p>
      ) : null}
      <textarea
        className="result-panel-text"
        aria-label="识别结果文本"
        value={text}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="result-panel-foot">
        <span className="result-panel-hint">{panelHint(payload?.canEscape ?? false)}</span>
        <div className="result-panel-actions">
          {undoAvailable ? (
            <button type="button" className="result-panel-quiet" onClick={undo}>
              撤销上一次插入
            </button>
          ) : null}
          <button type="button" className="result-panel-quiet" onClick={copy}>
            {copied ? '已复制' : '复制'}
          </button>
          <button
            type="button"
            className="result-panel-copy"
            onClick={reinsert}
            disabled={text.trim().length === 0}
          >
            重新插入
          </button>
        </div>
      </div>
    </div>
  )
}
