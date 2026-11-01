import type { FocusKind } from '../focus/editability'

/**
 * Where a finished transcript goes.
 *
 * Exactly one target is chosen. When the app's own window holds focus, a
 * synthesized ⌘V would write the text into our own input and the renderer would
 * insert it again — the same dictation twice. Otherwise the frontmost app is
 * the target, but only when Accessibility says its focused element can accept
 * text; anything else (a non-editable view, or a probe that cannot answer)
 * gets the copy panel instead of a paste into the void.
 */
export type DeliveryTarget = 'insert' | 'paste' | 'panel'

export function deliveryTarget(input: {
  appFocused: boolean
  focus: FocusKind
}): DeliveryTarget {
  if (input.appFocused) return 'insert'
  return input.focus === 'editable' ? 'paste' : 'panel'
}

/** The ways a transcript can land, injected so the choice stays testable. */
export interface DeliveryPorts {
  /** Reads the real OS focus state; false while another app is frontmost. */
  appFocused: () => boolean
  /** Reads the frontmost element's editability; rejecting means unknown. */
  probeFocus: () => Promise<FocusKind>
  /** Hand the text to the app's own input, without touching the clipboard. */
  insert: (text: string) => void
  /** Paste into the frontmost app through the clipboard. */
  paste: (text: string) => Promise<void>
  /** Show the persistent copy panel; nothing is pasted. */
  showPanel: (text: string) => void
}

/**
 * Route one transcript to exactly one target. Returns which one ran, so a
 * caller can record it without re-deriving the decision. A probe failure is
 * `unknown`, which lands on the panel — never a silent paste.
 */
export async function deliverTranscript(
  text: string,
  ports: DeliveryPorts
): Promise<DeliveryTarget> {
  if (ports.appFocused()) {
    ports.insert(text)
    return 'insert'
  }

  let focus: FocusKind = 'unknown'
  try {
    focus = await ports.probeFocus()
  } catch {
    focus = 'unknown'
  }
  const target = deliveryTarget({ appFocused: false, focus })
  if (target === 'paste') {
    await ports.paste(text)
    return 'paste'
  }
  ports.showPanel(text)
  return 'panel'
}
