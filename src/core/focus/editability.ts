/**
 * Can the frontmost app accept a paste right now?
 *
 * The probe runs through macOS Accessibility, which exposes the focused
 * element's role and whether it carries a text selection range. Both matter:
 * Finder's desktop is an `AXGroup` that still advertises an (empty) range, and
 * Chrome's page surface is an `AXWebArea` that does too. Trusting the range
 * alone would paste into the void, so the role has to be an editable one.
 *
 * Anything the probe cannot read is `unknown`, and the caller must show the
 * copy panel rather than guessing — the plan card's first frozen decision.
 */

export const EDITABLE_FOCUS_ROLES = ['AXTextField', 'AXTextArea', 'AXComboBox'] as const

export type FocusKind = 'editable' | 'non-editable' | 'unknown'

/**
 * Everything the guard needs to decide whether the frontmost element is the
 * same target that received an insertion. `appName`, `role` and `identity`
 * only exist on the extended probe; a legacy two-field answer leaves them
 * empty, which makes the guard refuse rather than guess.
 */
export interface FocusTarget {
  kind: FocusKind
  /** Frontmost process name, or null when the probe cannot read it. */
  appName: string | null
  /** Best-effort bundle identifier, used only by the result-panel path. */
  bundleId: string | null
  /** AX role of the focused element, or null when unreadable. */
  role: string | null
  /** AXIdentifier, else AXTitle, else ''. */
  identity: string
}

export const UNKNOWN_FOCUS_TARGET: FocusTarget = {
  kind: 'unknown',
  appName: null,
  bundleId: null,
  role: null,
  identity: ''
}

/** The probe's wire format is one line: `<role>|<0|1 for AXSelectedTextRange>`. */
export function parseFocusProbeLine(raw: string): FocusKind {
  const line = raw.trim()
  if (line === '' || line === 'UNKNOWN') return 'unknown'

  const separator = line.lastIndexOf('|')
  if (separator < 0) return 'unknown'
  const role = line.slice(0, separator).trim()
  const hasRange = line.slice(separator + 1).trim()
  if (role === '' || (hasRange !== '0' && hasRange !== '1')) return 'unknown'
  if (hasRange === '0') return 'non-editable'

  return (EDITABLE_FOCUS_ROLES as readonly string[]).includes(role)
    ? 'editable'
    : 'non-editable'
}

function kindOf(role: string, hasRange: string): FocusKind {
  if (role === '' || (hasRange !== '0' && hasRange !== '1')) return 'unknown'
  if (hasRange === '0') return 'non-editable'
  return (EDITABLE_FOCUS_ROLES as readonly string[]).includes(role)
    ? 'editable'
    : 'non-editable'
}

/**
 * Parse the extended probe: five newline-separated fields
 * (`appName`, `bundleId`, `role`, `hasRange`, `identity`). A legacy
 * `role|hasRange` answer is still accepted, with no app identity; the guard
 * then treats the target as unverifiable instead of assuming it is the same.
 */
export function parseFocusProbeTarget(raw: string): FocusTarget {
  const normalized = raw.replace(/\r\n/g, '\n')
  const text = normalized.trim()
  if (text === '' || text === 'UNKNOWN') return UNKNOWN_FOCUS_TARGET

  const lines = normalized.split('\n')
  // The probe ends with a linefeed; drop that one empty tail so an
  // intentionally empty identity field still occupies its line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  if (lines.length < 5) {
    if (lines.length !== 1) return UNKNOWN_FOCUS_TARGET
    const legacy = lines[0].trim()
    const kind = parseFocusProbeLine(legacy)
    if (kind === 'unknown') return UNKNOWN_FOCUS_TARGET
    const separator = legacy.lastIndexOf('|')
    const role = separator < 0 ? '' : legacy.slice(0, separator).trim()
    return {
      kind,
      appName: null,
      bundleId: null,
      role: role === '' ? null : role,
      identity: ''
    }
  }

  const appName = lines[0].trim()
  const bundleId = lines[1].trim()
  const role = lines[2].trim()
  const hasRange = lines[3].trim()
  // An identifier may itself contain a newline; keep the rest intact.
  const identity = lines.slice(4).join('\n').trim()
  const kind = kindOf(role, hasRange)
  if (kind === 'unknown') return UNKNOWN_FOCUS_TARGET

  return {
    kind,
    appName: appName === '' ? null : appName,
    bundleId: bundleId === '' ? null : bundleId,
    role: role === '' ? null : role,
    identity
  }
}
