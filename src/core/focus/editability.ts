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
/**
 * The real `AXSelectedTextRange` reading, in the target's caret units.
 * `null` means the value could not be read; it is never reported as `{0, 0}`,
 * because location 0 is a valid caret position.
 */
export interface FocusSelection {
  location: number
  length: number
}

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
  /** The real selection range, or null when the probe could not read it. */
  selection: FocusSelection | null
}

export const UNKNOWN_FOCUS_TARGET: FocusTarget = {
  kind: 'unknown',
  appName: null,
  bundleId: null,
  role: null,
  identity: '',
  selection: null
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
 * Parse the two selection fields. An unreadable value is the literal `NONE`
 * (or anything non-numeric), and it is reported as `null` rather than a made-up
 * zero, so the undo guard can tell "caret at 0" from "could not read".
 */
function parseSelection(location: string, length: string): FocusSelection | null {
  if (!/^\d+$/.test(location) || !/^\d+$/.test(length)) return null
  return { location: Number(location), length: Number(length) }
}

/**
 * Parse the extended probe. The current wire format is seven fields
 * (`appName`, `bundleId`, `role`, `hasRange`, `selectionLocation`,
 * `selectionLength`, `identity`); an identity may contain newlines and keeps
 * the rest of the answer.
 *
 * The legacy five-field format (`appName`, `bundleId`, `role`, `hasRange`,
 * `identity`) and the two-field `role|hasRange` answer are still accepted, with
 * `selection: null` and, for the two-field answer, no app identity. The guard
 * treats both as unverifiable rather than assuming the same target.
 */
export function parseFocusProbeTarget(raw: string): FocusTarget {
  const normalized = raw.replace(/\r\n/g, '\n')
  const text = normalized.trim()
  if (text === '' || text === 'UNKNOWN') return UNKNOWN_FOCUS_TARGET

  const lines = normalized.split('\n')
  // The probe ends with a linefeed; drop that one empty tail so an
  // intentionally empty identity field still occupies its line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  if (lines.length === 1) {
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
      identity: '',
      selection: null
    }
  }

  // Five lines predate the selection fields. An empty identity still occupies
  // its line once the trailing linefeed is dropped, so this is unambiguous.
  if (lines.length === 5) {
    const appName = lines[0].trim()
    const bundleId = lines[1].trim()
    const role = lines[2].trim()
    const hasRange = lines[3].trim()
    const identity = lines.slice(4).join('\n').trim()
    const kind = kindOf(role, hasRange)
    if (kind === 'unknown') return UNKNOWN_FOCUS_TARGET
    return {
      kind,
      appName: appName === '' ? null : appName,
      bundleId: bundleId === '' ? null : bundleId,
      role: role === '' ? null : role,
      identity,
      selection: null
    }
  }

  if (lines.length < 6) return UNKNOWN_FOCUS_TARGET

  const appName = lines[0].trim()
  const bundleId = lines[1].trim()
  const role = lines[2].trim()
  const hasRange = lines[3].trim()
  const selection = parseSelection(lines[4].trim(), lines[5].trim())
  // An identifier may itself contain a newline; keep the rest intact.
  const identity = lines.slice(6).join('\n').trim()
  const kind = kindOf(role, hasRange)
  if (kind === 'unknown') return UNKNOWN_FOCUS_TARGET

  return {
    kind,
    appName: appName === '' ? null : appName,
    bundleId: bundleId === '' ? null : bundleId,
    role: role === '' ? null : role,
    identity,
    selection
  }
}
