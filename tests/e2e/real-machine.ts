/**
 * Shared plumbing for the opt-in real-machine specs.
 *
 * Everything here talks to the real system: `osascript` for Apple Events and
 * `open` for LaunchServices. Nothing is shimmed, which is the whole point of
 * these specs — the shim-based suites prove the decision logic, these prove the
 * macOS side.
 *
 * Paths and document names are escaped and arrive as `osascript -e` arguments,
 * so a name containing a quote cannot change the program. The scripts are still
 * text with values spliced in; the escaping is what keeps that safe.
 *
 * Safety rules the helpers enforce:
 *
 * 1. A missing prerequisite throws with the reason. It is never turned into a
 *    skip: a spec that cannot run must fail loudly (see
 *    `openspec/specs/real-machine-verification/spec.md`).
 * 2. The specs own the only TextEdit instance they touch. `assertTextEditIdle`
 *    refuses to start when TextEdit is already running, and closing targets the
 *    documents this run opened by path — never `every document`.
 * 3. Destructive keystrokes are checked and sent inside one AppleScript, the
 *    same way `src/core/injection/delete.ts` does it, so a focus change between
 *    "check" and "send" cannot redirect the key.
 */
import { spawnSync } from 'node:child_process'

export interface AppleScriptResult {
  status: number
  stdout: string
  stderr: string
}

function escapeForAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
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

/**
 * The specs must never act on a TextEdit the user is using: `open` would reuse
 * that instance, and closing documents at the end would discard unsaved work.
 */
export function assertTextEditIdle(): void {
  const running = runAppleScript(
    'tell application "System Events" to return exists (first process whose name is "TextEdit")'
  )
  if (running.status !== 0) {
    throw new Error(`Could not inspect TextEdit: ${running.stderr}`)
  }
  if (running.stdout === 'true') {
    throw new Error(
      'TextEdit is already running. Quit it (saving anything you need) and re-run: these checks open and close their own documents and must not touch yours.'
    )
  }
}

/** Make `name` the frontmost process; returns true when it got there. */
export function activateApp(name: string): boolean {
  const result = runAppleScript(
    `tell application "System Events" to set frontmost of (first process whose name is "${escapeForAppleScript(name)}") to true`
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
 *
 * A standalone check is a hint, not a guarantee — use `keystrokeToPid`, which
 * re-checks inside the same AppleScript that sends the key.
 */
export function frontmostPid(): number {
  const result = runAppleScript(
    'tell application "System Events" to return unix id of first process whose frontmost is true'
  )
  const pid = Number(result.stdout)
  return Number.isFinite(pid) ? pid : -1
}

/** Open a file in TextEdit and wait until *that* document exists. */
export function openTextEditDocument(file: string): void {
  const opened = spawnSync('open', ['-a', 'TextEdit', file], { encoding: 'utf8' })
  if (opened.status !== 0) {
    throw new Error(`open -a TextEdit failed: ${opened.stderr}`)
  }
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const exists = runAppleScript(
      `with timeout of 5 seconds\ntell application "TextEdit" to return exists (first document whose path is "${escapeForAppleScript(file)}")\nend timeout`
    )
    if (exists.status === 0 && exists.stdout === 'true') return
    spawnSync('sleep', ['0.2'])
  }
  throw new Error(`TextEdit did not open ${file} within 15s.`)
}

/** The text of the document backed by this file. */
export function readTextEditDocument(file: string): string {
  return mustRunAppleScript(
    `with timeout of 10 seconds\ntell application "TextEdit" to return text of (first document whose path is "${escapeForAppleScript(file)}")\nend timeout`
  )
}

/**
 * Bring this document's window forward, put the caret in its text area and
 * move to the very end. Undo assumes the caret sits after the inserted text,
 * so the check has to establish that state explicitly.
 */
export function focusTextEditDocument(file: string): void {
  mustRunAppleScript(
    `tell application "TextEdit"
  set index of (first document whose path is "${escapeForAppleScript(file)}") to 1
  activate
end tell
tell application "System Events"
  tell process "TextEdit"
    set frontmost to true
    set focused of text area 1 of scroll area 1 of window 1 to true
  end tell
  -- Command+Down moves the caret to the end of the document.
  key code 125 using command down
end tell`
  )
}

/** Close the documents this run opened — by path, never "every document". */
export function closeTextEditDocuments(files: string[]): void {
  for (const file of files) {
    runAppleScript(
      `with timeout of 10 seconds
tell application "TextEdit"
  if exists (first document whose path is "${escapeForAppleScript(file)}") then close (first document whose path is "${escapeForAppleScript(file)}") saving no
end tell
end timeout`
    )
  }
}

/** Quit TextEdit. Only call this when the spec opened it itself. */
export function quitTextEdit(): void {
  runAppleScript(
    'with timeout of 10 seconds\ntell application "TextEdit" to quit\nend timeout'
  )
}

/** Grapheme clusters, the unit the undo delete counts. */
export function graphemeCount(text: string): number {
  return Array.from(
    new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text)
  ).length
}

export type RealKeyResult = 'ok' | 'not-frontmost'

/**
 * Send a keystroke only if `pid` is still frontmost, checking inside the same
 * AppleScript that presses the key. A separate check followed by a separate
 * send leaves a window in which a focus change sends the key elsewhere.
 */
export function keystrokeToPid(
  pid: number,
  text: string,
  using: string[] = []
): RealKeyResult {
  const modifiers =
    using.length === 0
      ? ''
      : ` using {${using.map((name) => `${name} down`).join(', ')}}`
  const result = mustRunAppleScript(
    `tell application "System Events"
  set frontPid to unix id of first process whose frontmost is true
  if frontPid is not ${Math.trunc(pid)} then return "not-frontmost"
  keystroke "${escapeForAppleScript(text)}"${modifiers}
  return "ok"
end tell`
  )
  return result === 'ok' ? 'ok' : 'not-frontmost'
}
