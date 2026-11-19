/**
 * Shared plumbing for the opt-in real-machine specs.
 *
 * Everything here talks to the real system: `osascript` for Apple Events and
 * `open` for LaunchServices. Nothing is shimmed, which is the whole point of
 * these specs — the shim-based suites prove the decision logic, these prove the
 * macOS side.
 *
 * Two rules the helpers enforce:
 *
 * 1. Scripts are passed as `osascript -e` arguments, never assembled by string
 *    interpolation of user or file data, so a path containing quotes cannot
 *    change the program.
 * 2. A missing prerequisite throws with the reason. It is never turned into a
 *    skip: a spec that cannot run must fail loudly (see
 *    `openspec/specs/real-machine-verification/spec.md`).
 */
import { spawnSync } from 'node:child_process'

export interface AppleScriptResult {
  status: number
  stdout: string
  stderr: string
}

export function runAppleScript(script: string): AppleScriptResult {
  const result = spawnSync('osascript', ['-e', script], {
    encoding: 'utf8',
    timeout: 20_000
  })
  return {
    status: result.status ?? -1,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim()
  }
}

/** Run a script and return stdout, throwing with the interpreter's own words. */
export function mustRunAppleScript(script: string): string {
  const result = runAppleScript(script)
  if (result.status !== 0) {
    throw new Error(
      `AppleScript failed (exit ${result.status}): ${result.stderr || result.stdout}`
    )
  }
  return result.stdout
}

/**
 * Refuse to run unless this process can actually drive the GUI.
 *
 * The checks below are the ones that have bitten us: Accessibility withheld,
 * no Aqua session (an SSH/tmux login lives in the launchd Background domain and
 * cannot activate or enumerate another app's windows), and a locked screen.
 */
export function assertRealMachineGrants(): void {
  if (process.platform !== 'darwin') {
    throw new Error('Real-machine checks require macOS.')
  }

  const trusted = runAppleScript(
    'tell application "System Events" to return UI elements enabled'
  )
  if (trusted.status !== 0) {
    throw new Error(
      'System Events is unreachable. Grant Automation consent ("Terminal wants to control System Events") and retry. ' +
        trusted.stderr
    )
  }
  if (trusted.stdout !== 'true') {
    throw new Error(
      'Accessibility is off for the process running these tests. Open System Settings → Privacy & Security → Accessibility, enable the terminal (or whatever app hosts the test runner), then re-run.'
    )
  }

  const session = spawnSync('launchctl', ['managername'], { encoding: 'utf8' })
  const domain = String(session.stdout ?? '').trim()
  if (domain !== 'Aqua') {
    throw new Error(
      `This session runs in the launchd "${domain}" domain, which cannot activate or drive real windows. Run the spec from a terminal opened on the Mac itself (not an SSH or tmux session).`
    )
  }

  const locked = spawnSync('ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8' })
  if (String(locked.stdout ?? '').includes('CGSSessionScreenIsLocked"=Yes')) {
    throw new Error(
      'The screen is locked. Unlock the Mac and re-run: a locked screen blocks every cross-app keystroke.'
    )
  }
}

/** Make `name` the frontmost process; returns true when it got there. */
export function activateApp(name: string): boolean {
  const result = runAppleScript(
    `tell application "System Events" to set frontmost of (first process whose name is "${name}") to true`
  )
  return result.status === 0
}

export function frontmostApp(): string {
  const result = runAppleScript(
    'tell application "System Events" to return name of first process whose frontmost is true'
  )
  return result.status === 0 ? result.stdout : ''
}

/**
 * PID of the frontmost process. Compare it with the test instance's own PID
 * before sending any destructive chord: a keystroke sent while the user's
 * instance (or any other app) is frontmost would hit that app instead.
 */
export function frontmostPid(): number {
  const result = runAppleScript(
    'tell application "System Events" to return unix id of first process whose frontmost is true'
  )
  const pid = Number(result.stdout)
  return Number.isFinite(pid) ? pid : -1
}

/** Open a file in TextEdit and wait until the document window exists. */
export function openTextEditDocument(file: string): void {
  const opened = spawnSync('open', ['-a', 'TextEdit', file], { encoding: 'utf8' })
  if (opened.status !== 0) {
    throw new Error(`open -a TextEdit failed: ${opened.stderr}`)
  }
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const count = runAppleScript(
      'with timeout of 5 seconds\ntell application "TextEdit" to return count of documents\nend timeout'
    )
    if (count.status === 0 && Number(count.stdout) > 0) return
    spawnSync('sleep', ['0.2'])
  }
  throw new Error('TextEdit did not open a document within 10s.')
}

/** The text of the Nth (1-based) TextEdit document. */
export function readTextEditDocument(index = 1): string {
  return mustRunAppleScript(
    `with timeout of 10 seconds\ntell application "TextEdit" to return text of document ${index}\nend timeout`
  )
}

/**
 * The text of the document with this name. TextEdit's `document 1` follows
 * window order, which changes as documents are opened and focused, so a test
 * that adds a second document must address documents by name.
 */
export function readTextEditDocumentNamed(name: string): string {
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return mustRunAppleScript(
    `with timeout of 10 seconds\ntell application "TextEdit" to return text of document "${escaped}"\nend timeout`
  )
}

/**
 * Put the keyboard focus into the first text area of a document and leave the
 * caret at the very end. Undo assumes the caret sits after the inserted text,
 * so the check has to establish that state explicitly. Pass a document name
 * when more than one document is open — `window 1` is whatever was focused
 * last.
 */
export function focusTextEditCaretAtEnd(documentName?: string): void {
  const target =
    documentName === undefined
      ? 'window 1'
      : `window "${documentName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  mustRunAppleScript(
    `tell application "TextEdit" to activate
tell application "System Events"
  tell process "TextEdit"
    set frontmost to true
    set focused of text area 1 of scroll area 1 of ${target} to true
  end tell
  -- Command+Down moves the caret to the end of the document.
  key code 125 using command down
end tell`
  )
}

/** Close every TextEdit document without saving, then quit the app. */
export function closeTextEdit(): void {
  runAppleScript(
    'with timeout of 10 seconds\ntell application "TextEdit" to close every document saving no\nend timeout'
  )
  runAppleScript('with timeout of 10 seconds\ntell application "TextEdit" to quit\nend timeout')
}

/** Close and quit TextEdit only if it is running; never touches other apps. */
export function quitTextEditIfRunning(): void {
  const running = runAppleScript(
    'tell application "System Events" to return exists (first process whose name is "TextEdit")'
  )
  if (running.stdout === 'true') closeTextEdit()
}

/** Grapheme clusters, the unit the undo delete counts. */
export function graphemeCount(text: string): number {
  return Array.from(
    new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text)
  ).length
}

/** Send a key chord through the real system keyboard path. */
export function pressKey(code: number, using: string[] = []): void {
  const modifiers =
    using.length === 0 ? '' : ` using {${using.map((name) => `${name} down`).join(', ')}}`
  mustRunAppleScript(
    `tell application "System Events" to key code ${code}${modifiers}`
  )
}

/** Send a literal keystroke, e.g. `"'"` with Command held. */
export function keystroke(text: string, using: string[] = []): void {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const modifiers =
    using.length === 0 ? '' : ` using {${using.map((name) => `${name} down`).join(', ')}}`
  mustRunAppleScript(
    `tell application "System Events" to keystroke "${escaped}"${modifiers}`
  )
}
