import React, { useCallback, useEffect, useState } from 'react'
import { acceleratorDisplayParts } from '../../core/hotkey/accelerator'
import {
  describeAccessibility,
  describeMicrophone,
  type PermissionLine
} from '../../core/onboarding/status'
import type { PermissionStatus } from '../../shared/ipc'

interface OnboardingProps {
  hotkey: string
  onDone: () => void
}

function PermissionRow({
  title,
  line,
  action
}: {
  title: string
  line: PermissionLine | null
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <li className="onboarding-permission">
      <div className="onboarding-permission-head">
        <span className="onboarding-permission-title">{title}</span>
        {line ? (
          <span className={`permission-badge ${line.tone}`}>{line.label}</span>
        ) : (
          <span className="permission-badge">检查中…</span>
        )}
      </div>
      <p className="onboarding-permission-hint">{line?.hint ?? '正在读取系统状态。'}</p>
      {action ? <div className="onboarding-permission-actions">{action}</div> : null}
    </li>
  )
}

/**
 * One short first-run screen: the hotkey, where text goes, and the two
 * permissions the dictation path needs. Accessibility is re-checked whenever
 * the window regains focus, which is exactly when the user comes back from
 * System Settings.
 */
export function Onboarding({ hotkey, onDone }: OnboardingProps): React.JSX.Element {
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null)
  const [error, setError] = useState<string | undefined>()

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setPermissions(await window.justspeak.getPermissions())
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = (): void => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const keys = acceleratorDisplayParts(hotkey)
  const accessibility = permissions ? describeAccessibility(permissions.accessibility) : null
  const microphone = permissions ? describeMicrophone(permissions.microphone) : null

  const openAccessibility = (): void => {
    void window.justspeak.openAccessibilitySettings().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  return (
    <div className="onboarding-backdrop">
      <section className="onboarding" aria-label="首次使用引导">
        <header className="onboarding-head">
          <h1>欢迎使用 JustSpeak</h1>
          <p>说一句话，文字落在光标处。全程在本机完成识别。</p>
        </header>

        <ol className="onboarding-steps">
          <li className="onboarding-step">
            <span className="onboarding-index">1</span>
            <div>
              <h2>按快捷键开始</h2>
              <p>
                任何时候按
                <span className="onboarding-keys">
                  {keys.map((key, index) => (
                    <kbd key={`${key}-${index}`}>{key}</kbd>
                  ))}
                </span>
                开始，再说一次结束。
              </p>
            </div>
          </li>

          <li className="onboarding-step">
            <span className="onboarding-index">2</span>
            <div>
              <h2>文字会去哪里</h2>
              <p>
                JustSpeak 在前台时插入首页输入框；其他应用可输入时自动粘贴；焦点不在输入框时，
                会弹出复制面板，不会把文字粘到不该去的地方。
              </p>
            </div>
          </li>

          <li className="onboarding-step">
            <span className="onboarding-index">3</span>
            <div>
              <h2>授予两个权限</h2>
              <ul className="onboarding-permissions">
                <PermissionRow title="麦克风" line={microphone} />
                <PermissionRow
                  title="辅助功能"
                  line={accessibility}
                  action={
                    <>
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={openAccessibility}
                      >
                        打开系统设置
                      </button>
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() => void refresh()}
                      >
                        重新检查
                      </button>
                    </>
                  }
                />
              </ul>
            </div>
          </li>
        </ol>

        <footer className="onboarding-foot">
          {error ? <p className="onboarding-error">{error}</p> : null}
          <button type="button" className="onboarding-start" onClick={onDone}>
            开始使用
          </button>
        </footer>
      </section>
    </div>
  )
}
