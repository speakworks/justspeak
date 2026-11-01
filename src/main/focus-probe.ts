import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseFocusProbeLine, type FocusKind } from '../core/focus/editability'

const execFileAsync = promisify(execFile)

/**
 * Same generous cap as the paste port. The probe runs before paste, so a 3 s
 * cap (the old paste value that was demonstrably too tight) would turn a slow
 * but healthy machine into a silent panel fallback.
 */
const FOCUS_PROBE_TIMEOUT_MS = 10_000

/**
 * Ask macOS Accessibility for the frontmost element's role and whether it has
 * a text selection range. System Events is already the injection path (paste),
 * so this adds no new permission; when the probe cannot answer, the caller
 * shows the copy panel instead of pasting. That fallback is intentional: a
 * wrong paste writes into a view that cannot be undone.
 */
const FOCUS_PROBE_SCRIPT = `
tell application "System Events"
  try
    set frontName to name of first process whose frontmost is true
    tell process frontName
      set focusedElement to value of attribute "AXFocusedUIElement"
      set focusedRole to role of focusedElement as text
      set hasRange to "0"
      try
        set selectedRange to value of attribute "AXSelectedTextRange" of focusedElement
        set hasRange to "1"
      end try
      return focusedRole & "|" & hasRange
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
      return parseFocusProbeLine(String(stdout))
    } catch (error) {
      console.warn('[focus] probe failed; showing the copy panel', error)
      return 'unknown'
    }
  }
}
