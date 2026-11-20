import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  parseFocusProbeTarget,
  type FocusKind,
  type FocusTarget
} from '../core/focus/editability'
const execFileAsync = promisify(execFile)

/**
 * Same generous cap as the paste port. The probe runs before paste, so a 3 s
 * cap (the old paste value that was demonstrably too tight) would turn a slow
 * but healthy machine into a silent panel fallback.
 */
const FOCUS_PROBE_TIMEOUT_MS = 10_000

/**
 * Ask macOS Accessibility for the frontmost element's role, whether it has a
 * text selection range, and — when it does — the real range `location` and
 * `length`. System Events is already the injection path (paste), so this adds
 * no new permission; when the probe cannot answer, the caller shows the copy
 * panel instead of pasting. That fallback is intentional: a wrong paste writes
 * into a view that cannot be undone.
 *
 * The selection value is emitted as `NONE` when it cannot be read or parsed.
 * It is deliberately never written as `0`: location 0 is a valid caret
 * position, and the undo guard must be able to tell "caret at the start" from
 * "the value is unreadable".
 */
const FOCUS_PROBE_SCRIPT = `
tell application "System Events"
  try
    set frontProcess to first process whose frontmost is true
    set frontName to name of frontProcess
    set frontBundle to ""
    try
      set frontBundle to bundle identifier of frontProcess
    end try
    if frontBundle is missing value then set frontBundle to ""
    tell frontProcess
      set focusedElement to value of attribute "AXFocusedUIElement"
      set focusedRole to role of focusedElement as text
      set hasRange to "0"
      set selectionLocation to "NONE"
      set selectionLength to "NONE"
      try
        set selectedRange to value of attribute "AXSelectedTextRange" of focusedElement
        set hasRange to "1"
        try
          set selectionLocation to (item 1 of selectedRange) as text
          set selectionLength to (item 2 of selectedRange) as text
        on error
          try
            set selectionLocation to (location of selectedRange) as text
            set selectionLength to (length of selectedRange) as text
          on error
            set selectionLocation to "NONE"
            set selectionLength to "NONE"
          end try
        end try
      end try
      set ident to ""
      try
        set ident to value of attribute "AXIdentifier" of focusedElement as text
      end try
      if ident is missing value then set ident to ""
      if ident is "" then
        try
          set ident to value of attribute "AXTitle" of focusedElement as text
        end try
        if ident is missing value then set ident to ""
      end if
      return frontName & linefeed & frontBundle & linefeed & focusedRole & linefeed & hasRange & linefeed & selectionLocation & linefeed & selectionLength & linefeed & ident
    end tell
  on error
    return "UNKNOWN"
  end try
end tell
`

export type FocusExec = (
  command: string,
  args: string[],
  options: { timeout: number }
) => Promise<{ stdout: string | Buffer }>

export function createFocusProbe(
  exec: FocusExec = execFileAsync
): () => Promise<FocusKind> {
  return async () => {
    try {
      const { stdout } = await exec('osascript', ['-e', FOCUS_PROBE_SCRIPT], {
        timeout: FOCUS_PROBE_TIMEOUT_MS
      })
      // The extended parser also accepts the old two-field answer, so this
      // wrapper stays useful even though the script now emits five fields.
      return parseFocusProbeTarget(String(stdout)).kind
    } catch (error) {
      console.warn('[focus] probe failed; showing the copy panel', error)
      return 'unknown'
    }
  }
}

/**
 * The extended probe used by the undo guard. It answers with the frontmost
 * app, the focused element's role and its identity, so a refusal can name what
 * changed instead of guessing. A failed probe is `unknown`, which the guard
 * treats as a refusal.
 */
export function createFocusTargetProbe(
  exec: FocusExec = execFileAsync
): () => Promise<FocusTarget> {
  return async () => {
    try {
      const { stdout } = await exec('osascript', ['-e', FOCUS_PROBE_SCRIPT], {
        timeout: FOCUS_PROBE_TIMEOUT_MS
      })
      return parseFocusProbeTarget(String(stdout))
    } catch (error) {
      console.warn('[focus] target probe failed; refusing automatic deletion', error)
      return {
        kind: 'unknown',
        appName: null,
        bundleId: null,
        role: null,
        identity: '',
        selection: null
      }
    }
  }
}
