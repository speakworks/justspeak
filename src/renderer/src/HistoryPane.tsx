import React from 'react'

/**
 * The history destination. It exists so the sidebar is honest about where
 * records will live; the list, storage and retention are a separate card.
 * The page header owns the title, so this pane is only the empty surface.
 */
export function HistoryPane(): React.JSX.Element {
  return (
    <section className="pane">
      <div className="sheet">
        <div className="pane-empty">
          <p className="pane-empty-title">还没有记录</p>
          <p className="pane-empty-hint">每次识别的内容都会出现在这里，可以回看和复制。</p>
        </div>
      </div>
    </section>
  )
}
