import { UNKNOWN_FOCUS_TARGET, type FocusKind, type FocusTarget } from '../focus/editability'

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
  probeFocus?: () => Promise<FocusKind>
  /**
   * Extended probe used by the correction path. When supplied it replaces
   * `probeFocus` and returns the app/role/identity the guard needs.
   */
  probeTarget?: () => Promise<FocusTarget>
  /** Hand the text to the app's own input, without touching the clipboard. */
  insert: (text: string) => void
  /** Paste into the frontmost app through the clipboard. */
  paste: (text: string) => Promise<void>
  /** Show the persistent copy panel; nothing is pasted. */
  showPanel: (text: string) => void
}

/** What a delivery did, plus the focus it was decided from. */
export interface DeliveryOutcome {
  target: DeliveryTarget
  /** `null` when the app's own window took the text and no probe ran. */
  focus: FocusTarget | null
}

/**
 * Route one transcript to exactly one target. Returns which one ran, so a
 * caller can record it without re-deriving the decision. A probe failure is
 * `unknown`, which lands on the panel — never a silent paste.
 */
export async function deliverTranscriptDetailed(
  text: string,
  ports: DeliveryPorts
): Promise<DeliveryOutcome> {
  if (ports.appFocused()) {
    ports.insert(text)
    return { target: 'insert', focus: null }
  }

  let focus: FocusTarget = UNKNOWN_FOCUS_TARGET
  try {
    if (ports.probeTarget) {
      focus = await ports.probeTarget()
    } else if (ports.probeFocus) {
      focus = { ...UNKNOWN_FOCUS_TARGET, kind: await ports.probeFocus() }
    }
  } catch {
    focus = UNKNOWN_FOCUS_TARGET
  }
  const target = deliveryTarget({ appFocused: false, focus: focus.kind })
  if (target === 'paste') {
    await ports.paste(text)
    return { target: 'paste', focus }
  }
  ports.showPanel(text)
  return { target: 'panel', focus }
}

export async function deliverTranscript(
  text: string,
  ports: DeliveryPorts
): Promise<DeliveryTarget> {
  return (await deliverTranscriptDetailed(text, ports)).target
}
