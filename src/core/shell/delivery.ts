/**
 * Where a finished transcript goes.
 *
 * Exactly one target is chosen. When the app's own window holds focus, a
 * synthesized ⌘V would write the text into our own input and the renderer would
 * insert it again — the same dictation twice. Otherwise the frontmost app is
 * the target, exactly as before.
 */
export type DeliveryTarget = 'insert' | 'paste'

export function deliveryTarget(input: { appFocused: boolean }): DeliveryTarget {
  return input.appFocused ? 'insert' : 'paste'
}

/** The two ways a transcript can land, injected so the choice stays testable. */
export interface DeliveryPorts {
  /** Reads the real OS focus state; false while another app is frontmost. */
  appFocused: () => boolean
  /** Hand the text to the app's own input, without touching the clipboard. */
  insert: (text: string) => void
  /** Paste into the frontmost app through the clipboard. */
  paste: (text: string) => Promise<void>
}

/**
 * Route one transcript to exactly one target. Returns which one ran, so a
 * caller can log or assert on the decision without re-deriving it.
 */
export async function deliverTranscript(
  text: string,
  ports: DeliveryPorts
): Promise<DeliveryTarget> {
  const target = deliveryTarget({ appFocused: ports.appFocused() })
  if (target === 'insert') {
    ports.insert(text)
    return 'insert'
  }
  await ports.paste(text)
  return 'paste'
}
