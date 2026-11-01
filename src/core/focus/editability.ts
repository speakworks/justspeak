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
