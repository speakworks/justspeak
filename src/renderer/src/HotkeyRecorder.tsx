import React, { useEffect, useRef, useState } from 'react'
import {
  acceleratorDisplayParts,
  modifierDisplayParts,
  type HotkeyModifier
} from '../../core/hotkey/accelerator'
import { captureHotkey, type HotkeyKeyInput } from '../../core/hotkey/capture'

export interface HotkeyRecorderProps {
  /** The accelerator that is live right now. */
  accelerator: string
  /** True only after main has unregistered the live hotkey and is waiting. */
  capturing: boolean
  busy: boolean
  onBegin: () => void
  onCaptured: (accelerator: string) => void
  onCancel: () => void
  /** Transient capture hint (for example "needs a modifier"). */
  onHint: (message?: string) => void
}

function Keycaps({ parts }: { parts: string[] }): React.JSX.Element {
  if (parts.length === 0) return <span className="hotkey-missing">未注册</span>
  return (
    <span className="hotkey-keycaps">
      {parts.map((part, index) => (
        <kbd key={`${part}-${index}`}>{part}</kbd>
      ))}
    </span>
  )
}

/**
 * A press-to-record accelerator control.
 *
 * Recording is bracketed by `beginHotkeyCapture` / `endHotkeyCapture` in main:
 * the live global shortcut has to be unregistered first, otherwise pressing a
 * chord (including the current one) would be swallowed by the app itself and
 * never reach this button. Escape cancels; only a modified Escape is captured.
 */
export function HotkeyRecorder({
  accelerator,
  capturing,
  busy,
  onBegin,
  onCaptured,
  onCancel,
  onHint
}: HotkeyRecorderProps): React.JSX.Element {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [modifiers, setModifiers] = useState<readonly HotkeyModifier[]>([])

  useEffect(() => {
    if (!capturing) {
      setModifiers([])
      return
    }
    // The click that starts recording normally leaves focus here; if it moved
    // during the IPC round trip, bring it back so the next key is captured.
    buttonRef.current?.focus()
  }, [capturing])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (!capturing) return
    // While recording the control owns every chord; nothing may leak to the
    // page or trigger the button's own Space/Enter activation.
    event.preventDefault()
    event.stopPropagation()

    const input: HotkeyKeyInput = {
      key: event.key,
      code: event.code,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey
    }
    const result = captureHotkey(input)

    if (result.status === 'pending') {
      setModifiers(result.modifiers)
      onHint(undefined)
      return
    }
    if (result.status === 'cancel') {
      onHint(undefined)
      onCancel()
      return
    }
    if (result.status === 'invalid') {
      onHint(result.message)
      return
    }
    onHint(undefined)
    onCaptured(result.accelerator)
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      className={[
        'hotkey-input',
        'hotkey-recorder',
        capturing ? 'capturing' : '',
        busy ? 'busy' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => {
        if (!capturing && !busy) onBegin()
      }}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (capturing && !busy) onCancel()
      }}
      disabled={busy}
      aria-label={
        capturing
          ? '正在录制快捷键：按下组合键，按 Esc 取消'
          : `当前快捷键 ${accelerator || '未注册'}，点击后按下新的组合键`
      }
    >
      {capturing ? (
        modifiers.length > 0 ? (
          <span className="hotkey-capturing">
            <Keycaps parts={modifierDisplayParts(modifiers)} />
            <span className="hotkey-wait">…</span>
          </span>
        ) : (
          <span className="hotkey-wait">请按下快捷键…</span>
        )
      ) : (
        <Keycaps parts={accelerator ? acceleratorDisplayParts(accelerator) : []} />
      )}
    </button>
  )
}
