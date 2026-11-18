/**
 * The only delete path in the app.
 *
 * The guard is not a pre-flight check followed by a separate keystroke script:
 * a window can change between the probe and the keys. The whole decision and
 * the presses therefore live in one AppleScript, whose expected app, bundle,
 * role, identity and count arrive as argv. If anything does not match at that
 * moment, the script returns a MISMATCH line and presses nothing.
 *
 * The frontmost app is re-checked before every key as well. That cannot remove
 * the last few microseconds of race, but it stops a user who switches apps
 * mid-delete from having the remaining presses land in the new window.
 */

export interface DeleteExpectation {
  appName: string
  bundleId: string | null
  role: string
  identity: string
}

export type DeleteOutcome =
  | { ok: true }
  | { ok: false; reason: string; message: string }

export const DELETE_SCRIPT = `
on run argv
  set expectedApp to item 1 of argv
  set expectedBundle to item 2 of argv
  set expectedRole to item 3 of argv
  set expectedIdentity to item 4 of argv
  set pressCount to (item 5 of argv) as integer
  if expectedIdentity is "" then return "MISMATCH|unverifiable-target"
  tell application "System Events"
    try
      set frontProcess to first process whose frontmost is true
      set frontName to name of frontProcess
      set frontBundle to ""
      try
        set frontBundle to bundle identifier of frontProcess
      end try
      if frontBundle is missing value then set frontBundle to ""
      if frontName is not expectedApp then return "MISMATCH|app-changed"
      if expectedBundle is not "" then
        if frontBundle is not expectedBundle then return "MISMATCH|bundle-changed"
      end if
      tell frontProcess
        set focusedElement to value of attribute "AXFocusedUIElement"
        set focusedRole to role of focusedElement as text
        if focusedRole is not expectedRole then return "MISMATCH|role-changed"
        set hasRange to "0"
        try
          set selectedRange to value of attribute "AXSelectedTextRange" of focusedElement
          set hasRange to "1"
        end try
        if hasRange is not "1" then return "MISMATCH|not-editable"
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
        if ident is not expectedIdentity then return "MISMATCH|identity-changed"
      end tell
      repeat with pressIndex from 1 to pressCount
        try
          set currentFrontProcess to first process whose frontmost is true
          set currentFrontName to name of currentFrontProcess
          if currentFrontName is not expectedApp then return "MISMATCH|app-changed-mid-delete"
          set currentBundle to ""
          try
            set currentBundle to bundle identifier of currentFrontProcess
          end try
          if currentBundle is missing value then set currentBundle to ""
          if expectedBundle is not "" then
            if currentBundle is not expectedBundle then return "MISMATCH|bundle-changed-mid-delete"
          end if
          tell currentFrontProcess
            set currentElement to value of attribute "AXFocusedUIElement"
            set currentRole to role of currentElement as text
            if currentRole is not expectedRole then return "MISMATCH|role-changed-mid-delete"
            set currentIdent to ""
            try
              set currentIdent to value of attribute "AXIdentifier" of currentElement as text
            end try
            if currentIdent is missing value then set currentIdent to ""
            if currentIdent is "" then
              try
                set currentIdent to value of attribute "AXTitle" of currentElement as text
              end try
              if currentIdent is missing value then set currentIdent to ""
            end if
            if currentIdent is not expectedIdentity then return "MISMATCH|identity-changed-mid-delete"
          end tell
          key code 51
        on error
          return "MISMATCH|mid-delete-error"
        end try
      end repeat
      return "OK"
    on error errMsg
      return "ERROR|" & errMsg
    end try
  end tell
end run
`

/**
 * Build argv for `osascript`. Every value is its own argument; nothing is
 * interpolated into the script text, so an app name or identifier containing
 * quotes cannot change the program.
 */
export function buildDeleteArgs(expected: DeleteExpectation, count: number): string[] {
  const presses = Math.floor(count)
  return [
    '-e',
    DELETE_SCRIPT,
    expected.appName,
    expected.bundleId ?? '',
    expected.role,
    expected.identity,
    String(presses)
  ]
}

const MISMATCH_MESSAGE: Record<string, string> = {
  'app-changed': '目标应用已改变',
  'bundle-changed': '目标应用已改变',
  'role-changed': '焦点已改变',
  'not-editable': '焦点不再可编辑',
  'unverifiable-target': '无法确认原来的输入位置',
  'identity-changed': '焦点已改变',
  'app-changed-mid-delete': '删除过程中目标应用已改变，删除可能未完整完成',
  'bundle-changed-mid-delete': '删除过程中目标应用已改变，删除可能未完整完成',
  'role-changed-mid-delete': '删除过程中焦点已改变，删除可能未完整完成',
  'identity-changed-mid-delete': '删除过程中焦点已改变，删除可能未完整完成',
  'mid-delete-error': '删除过程中出错，删除可能未完整完成'
}

/** These aborts happen before the first key is pressed. */
const PRE_KEY_REFUSALS = new Set([
  'app-changed',
  'bundle-changed',
  'role-changed',
  'not-editable',
  'unverifiable-target',
  'identity-changed'
])

export function isPreKeyRefusal(reason: string): boolean {
  return PRE_KEY_REFUSALS.has(reason)
}

/** Map the script's one-line answer to a typed outcome. */
export function parseDeleteResult(stdout: string): DeleteOutcome {
  const line =
    String(stdout)
      .trim()
      .split(/\r?\n/)
      .filter((value) => value.trim() !== '')
      .pop() ?? ''
  if (line === 'OK') return { ok: true }
  if (line.startsWith('MISMATCH|')) {
    const reason = line.slice('MISMATCH|'.length).trim() || 'mismatch'
    return {
      ok: false,
      reason,
      message: MISMATCH_MESSAGE[reason] ?? `删除中止（${reason}）`
    }
  }
  if (line.startsWith('ERROR|')) {
    return {
      ok: false,
      reason: 'error',
      message: '删除脚本执行失败，未确认完成'
    }
  }
  return {
    ok: false,
    reason: 'unknown',
    message: '删除结果无法确认，未假定成功'
  }
}
