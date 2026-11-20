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

/**
 * The hard ceiling for one guarded rollback. This is intentionally a constant,
 * not a preference: a mis-sized record must never turn into an unbounded
 * Backspace loop, and the value is not configurable by the user.
 */
export const MAX_UNDO_CHARS = 500

/** The current AX selection, in the target's caret units. */
export interface CaretReading {
  location: number
  length: number
}

/** What the insertion recorded about the span, before the paste happened. */
export interface CaretExpectation {
  /** `AXSelectedTextRange.location` read before the paste, or null. */
  insertionStart: number | null
  /** `AXSelectedTextRange.length` read before the paste, or null. */
  selectionLengthBefore: number | null
  /** Grapheme clusters inserted: the number of Backspaces to send. */
  insertedCount: number
  /** UTF-16 length of the inserted text: how far the caret advanced. */
  caretAdvance: number
}

export type CaretRefusalReason = 'too-long' | 'caret-moved' | 'selection-active'

export type CaretDecision =
  | {
      ok: true
      count: number
      /** The verified caret location, or null on the conservative path. */
      expectedCaret: number | null
      conservative: boolean
      /** Why the caret could not be verified; the caller logs this. */
      note: string | null
    }
  | { ok: false; reason: CaretRefusalReason; message: string }

/**
 * Decide whether the caret still sits at the end of the text this app
 * inserted.
 *
 * Only a collapsed caret exactly at `P0 + advance` may delete the recorded
 * span. A moved caret or an active selection refuses: deleting anyway would
 * remove the user's own characters. When the insertion point or the current
 * selection is unreadable, the decision stays conservative — send at most the
 * recorded count, never more — and reports why so the caller can log it.
 *
 * The hard `MAX_UNDO_CHARS` cap applies first and is independent of the caret.
 */
export function evaluateUndoCaret(input: {
  expectation: CaretExpectation
  current: CaretReading | null
}): CaretDecision {
  const { insertionStart, selectionLengthBefore, insertedCount, caretAdvance } =
    input.expectation

  if (insertedCount > MAX_UNDO_CHARS) {
    return {
      ok: false,
      reason: 'too-long',
      message: `需要回退 ${insertedCount} 个字符，超过单次上限 ${MAX_UNDO_CHARS}，未回退`
    }
  }

  if (insertionStart === null || selectionLengthBefore === null) {
    return {
      ok: true,
      count: insertedCount,
      expectedCaret: null,
      conservative: true,
      note: '插入时未读到插入点，按保守策略回退'
    }
  }

  if (input.current === null) {
    return {
      ok: true,
      count: insertedCount,
      expectedCaret: null,
      conservative: true,
      note: '无法读取当前插入点，按保守策略回退'
    }
  }

  if (input.current.length !== 0) {
    return {
      ok: false,
      reason: 'selection-active',
      message: '当前有选区，未回退'
    }
  }

  // The caret advances by the text's UTF-16 length in the same units AX uses.
  // A pre-existing selection is replaced, so the caret still lands at
  // `insertionStart + caretAdvance`; `selectionLengthBefore` only proves the
  // pre-paste range was readable.
  const expected = insertionStart + caretAdvance
  if (input.current.location !== expected) {
    return {
      ok: false,
      reason: 'caret-moved',
      message: '插入点已改变，未回退'
    }
  }

  return {
    ok: true,
    count: insertedCount,
    expectedCaret: expected,
    conservative: false,
    note: null
  }
}

export const DELETE_SCRIPT = `
on run argv
  set expectedApp to item 1 of argv
  set expectedBundle to item 2 of argv
  set expectedRole to item 3 of argv
  set expectedIdentity to item 4 of argv
  set pressCount to (item 5 of argv) as integer
  set expectedCaret to item 6 of argv
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
        if expectedCaret is not "" then
          try
            set currentSelection to value of attribute "AXSelectedTextRange" of focusedElement
            set currentCaretLocation to (item 1 of currentSelection) as integer
            set currentCaretLength to (item 2 of currentSelection) as integer
          on error
            return "MISMATCH|caret-unreadable"
          end try
          if currentCaretLength is not 0 then return "MISMATCH|selection-active"
          if currentCaretLocation is not (expectedCaret as integer) then return "MISMATCH|caret-moved"
        end if
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
export function buildDeleteArgs(
  expected: DeleteExpectation,
  count: number,
  expectedCaret: number | null = null
): string[] {
  const presses = Math.floor(count)
  return [
    '-e',
    DELETE_SCRIPT,
    expected.appName,
    expected.bundleId ?? '',
    expected.role,
    expected.identity,
    String(presses),
    // An empty value tells the script to skip the in-script caret check: that
    // happens only on the conservative path, where the count is already the
    // recorded maximum. Any other value pins the caret before the first key.
    expectedCaret === null ? '' : String(expectedCaret)
  ]
}

const MISMATCH_MESSAGE: Record<string, string> = {
  'app-changed': '目标应用已改变',
  'bundle-changed': '目标应用已改变',
  'role-changed': '焦点已改变',
  'not-editable': '焦点不再可编辑',
  'unverifiable-target': '无法确认原来的输入位置',
  'identity-changed': '焦点已改变',
  'caret-moved': '插入点已改变，未回退',
  'selection-active': '当前有选区，未回退',
  'caret-unreadable': '无法读取当前插入点，未回退',
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
  'identity-changed',
  'caret-moved',
  'selection-active',
  'caret-unreadable'
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
