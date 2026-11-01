import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  formatHistoryDuration,
  formatHistoryTime,
  groupHistoryByDate
} from '../../core/history'
import type { HistoryEntry, HistoryOutcome } from '../../shared/ipc'

const OUTCOME_LABEL: Record<HistoryOutcome, string> = {
  inserted: '已插入',
  pasted: '已粘贴',
  paste_failed: '粘贴失败',
  panel: '待复制'
}

const OUTCOME_TITLE: Record<HistoryOutcome, string> = {
  inserted: '已插入到 JustSpeak 输入框',
  pasted: '已粘贴到前台应用',
  paste_failed: '粘贴失败，文本已保留在剪贴板',
  panel: '焦点不在输入框，已弹出复制面板'
}


/**
 * The history destination. Main owns the file; this pane only reads it,
 * removes rows and copies text back through the clipboard bridge. A new
 * transcript arrives as a `history:changed` signal, so the list stays current
 * without polling.
 */
export function HistoryPane(): React.JSX.Element {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [error, setError] = useState<string | undefined>()
  const [busyId, setBusyId] = useState<string | undefined>()
  const [copiedId, setCopiedId] = useState<string | undefined>()
  const [playingId, setPlayingId] = useState<string | undefined>()
  const copyTimer = useRef<number | undefined>(undefined)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  /** Invalidates a slow `getHistoryAudio` load when playback is replaced. */
  const playToken = useRef(0)
  const loadingIdRef = useRef<string | undefined>(undefined)

  const stopPlayback = useCallback((): void => {
    playToken.current += 1
    audioRef.current?.pause()
    audioRef.current = null
    if (audioUrlRef.current !== null) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
    setPlayingId(undefined)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setEntries(await window.justspeak.getHistory())
      setError(undefined)
    } catch (cause) {
      // A failed read must not leave rows that look current under the error.
      setEntries([])
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const unsubscribe = window.justspeak.onHistoryChanged(() => {
      void refresh()
    })
    return () => {
      unsubscribe()
      if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
      // Unmount cleanup cannot set state; invalidate in-flight loads and
      // release the element and URL directly.
      playToken.current += 1
      loadingIdRef.current = undefined
      audioRef.current?.pause()
      audioRef.current = null
      if (audioUrlRef.current !== null) URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
  }, [refresh])

  const togglePlay = async (entry: HistoryEntry): Promise<void> => {
    if (playingId === entry.id) {
      stopPlayback()
      return
    }
    stopPlayback()
    const token = playToken.current
    loadingIdRef.current = entry.id
    try {
      const bytes = await window.justspeak.getHistoryAudio(entry.id)
      // A second click, a delete, or unmount may have superseded this load.
      if (token !== playToken.current) return
      loadingIdRef.current = undefined
      if (bytes === null) {
        setError('这段录音已被清理，文字仍然保留。')
        return
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
      audioUrlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = stopPlayback
      audio.onerror = () => {
        if (token !== playToken.current) return
        stopPlayback()
        setError('无法播放这段录音。')
      }
      setPlayingId(entry.id)
      await audio.play()
      setError(undefined)
    } catch (cause) {
      if (token !== playToken.current) return
      loadingIdRef.current = undefined
      stopPlayback()
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const copy = async (entry: HistoryEntry): Promise<void> => {
    try {
      await window.justspeak.copyText(entry.text)
      setError(undefined)
      setCopiedId(entry.id)
      if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopiedId(undefined), 1500)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const remove = async (entry: HistoryEntry): Promise<void> => {
    // Cover the row whose audio is still loading, not only the playing one.
    if (playingId === entry.id || loadingIdRef.current === entry.id) stopPlayback()
    setBusyId(entry.id)
    try {
      setEntries(await window.justspeak.deleteHistoryEntry(entry.id))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyId(undefined)
    }
  }

  const groups = groupHistoryByDate(entries)

  return (
    <section className="pane">
      {error ? <p className="sheet-message error">{error}</p> : null}
      {groups.length === 0 ? (
        // A failed read already owns the error line above; showing the empty
        // state next to it would present the failure as "no records".
        error ? null : (
          <div className="sheet">
            <div className="pane-empty">
              <p className="pane-empty-title">还没有记录</p>
              <p className="pane-empty-hint">
                每次识别的内容都会出现在这里，可以回看和复制。
              </p>
            </div>
          </div>
        )
      ) : (
        <div className="history">
          {groups.map((group) => (
            <section className="history-group" key={group.key}>
              <h2 className="history-date">{group.label}</h2>
              <div className="history-card">
                {group.entries.map((entry) => (
                  <article className="history-row" key={entry.id}>
                    <div className="history-main">
                      <div className="history-meta">
                        <time
                          className="history-time"
                          dateTime={new Date(entry.createdAt).toISOString()}
                        >
                          {formatHistoryTime(entry.createdAt)}
                        </time>
                        <span
                          className={`history-outcome ${entry.outcome}`}
                          title={OUTCOME_TITLE[entry.outcome]}
                        >
                          {OUTCOME_LABEL[entry.outcome]}
                        </span>
                        <span className="history-duration">
                          {formatHistoryDuration(entry.durationMs)}
                        </span>
                      </div>
                      <p className="history-text">{entry.text}</p>
                    </div>
                    <div className="history-actions">
                      {entry.audio ? (
                        <button
                          type="button"
                          className="quiet-button"
                          onClick={() => void togglePlay(entry)}
                        >
                          {playingId === entry.id ? '停止' : '播放'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() => void copy(entry)}
                      >
                        {copiedId === entry.id ? '已复制' : '复制'}
                      </button>
                      <button
                        type="button"
                        className="quiet-button history-delete"
                        onClick={() => void remove(entry)}
                        disabled={busyId === entry.id}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
