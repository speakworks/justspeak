import React from 'react'

export type Destination = 'home' | 'history' | 'dictionary' | 'settings'

const ITEMS: Array<{ id: Exclude<Destination, 'settings'>; label: string }> = [
  { id: 'home', label: '首页' },
  { id: 'history', label: '历史记录' },
  { id: 'dictionary', label: '词典' }
]

export interface SidebarProps {
  current: Destination
  onSelect: (destination: Destination) => void
  /** Label of the ASR provider main is running; the footer chip shows it. */
  providerLabel?: string
  /** True only when a provider session is actually usable. */
  providerLive: boolean
}

/**
 * Persistent destinations on the left. Settings sits with the provider chip in
 * the footer, out of the main list, so the list only ever names places the user
 * visits while working.
 */
export function Sidebar({
  current,
  onSelect,
  providerLabel,
  providerLive
}: SidebarProps): React.JSX.Element {
  return (
    <nav className="sidebar" aria-label="导航">
      <div className="sidebar-brand">
        <span className="sidebar-mark" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d="M3.4 6.2v3.6M6.2 4v8M9 5.4v5.2M11.8 6.6v2.8" />
          </svg>
        </span>
        <span>JustSpeak</span>
      </div>

      <ul className="sidebar-list">
        {ITEMS.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={current === item.id ? 'sidebar-item current' : 'sidebar-item'}
              aria-current={current === item.id ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
            >
              <ItemIcon id={item.id} />
              <span>{item.label}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="sidebar-foot">
        <button
          type="button"
          className="model-chip"
          title={providerLabel ?? '模型未就绪'}
          onClick={() => onSelect('settings')}
        >
          <span className={providerLive ? 'model-dot live' : 'model-dot'} aria-hidden="true" />
          <span className="model-name">{providerLabel ?? '模型未就绪'}</span>
        </button>
        <button
          type="button"
          className={current === 'settings' ? 'sidebar-gear current' : 'sidebar-gear'}
          aria-current={current === 'settings' ? 'page' : undefined}
          onClick={() => onSelect('settings')}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="2.3" />
            <path d="M8 2.2v1.4M8 12.4v1.4M2.2 8h1.4M12.4 8h1.4M3.9 3.9l1 1M11.1 11.1l1 1M12.1 3.9l-1 1M4.9 11.1l-1 1" />
          </svg>
          <span>设置</span>
        </button>
      </div>
    </nav>
  )
}

function ItemIcon({ id }: { id: Exclude<Destination, 'settings'> }): React.JSX.Element {
  if (id === 'home') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.8 7.4 8 3l5.2 4.4V13H9.7V9.6H6.3V13H2.8z" />
      </svg>
    )
  }
  if (id === 'history') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.2" />
        <path d="M8 5.2V8l2 1.3" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 3.2h3.4A1.6 1.6 0 0 1 8 4.8v8.4a1.6 1.6 0 0 0-1.6-1.6H3zM13 3.2H9.6A1.6 1.6 0 0 0 8 4.8v8.4a1.6 1.6 0 0 1 1.6-1.6H13z" />
    </svg>
  )
}
