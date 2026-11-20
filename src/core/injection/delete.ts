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

export type CaretRefusalReason =
  | 'too-long'
  | 'caret-moved'
  | 'selection-active'
  | 'caret-unverified'

export type CaretDecision =
  | {
      ok: true
      count: number
      /** The verified caret location. */
      expectedCaret: number
    }
  | {
      ok: false
      reason: CaretRefusalReason
      message: string
      /** Why the caret could not be verified; the caller logs this. */
      note?: string
    }

/**
 * Decide whether the caret still sits at the end of the text this app
 * inserted.
 *
 * Only a collapsed caret exactly at `P0 + advance` may delete the recorded
 * span. The active-selection check runs first, before any unreadable-value
 * branch: an insertion recorded without `P0` must still refuse to touch a
 * selection the user has made, because one Backspace would delete all of it.
 *
 * A moved caret, an active selection, or an unreadable insertion point /
 * current selection refuses and sends no Backspace. The refusal names which
 * value was missing so the caller can log it.
 *
 * The hard `MAX_UNDO_CHARS` cap is checked before the caret.
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

  // Blocking order: a live selection is a refusal even when the insertion
  // point was never recorded. Otherwise the conservative branches below would
  // press Backspace into the selection and delete the user's own text.
  if (input.current !== null && input.current.length !== 0) {
    return {
      ok: false,
      reason: 'selection-active',
      message: '当前有选区，未回退'
    }
  }

  if (insertionStart === null || selectionLengthBefore === null) {
    return {
      ok: false,
      reason: 'caret-unverified',
      message: '无法确认插入位置，未回退',
      note: '撤销被拒绝：插入时未读到插入点'
    }
  }

  if (input.current === null) {
    return {
      ok: false,
      reason: 'caret-unverified',
      message: '无法确认插入位置，未回退',
      note: '撤销被拒绝：无法读取当前插入点'
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
      message: '插入点已改变，未回退',
      note: '撤销被拒绝：当前插入点与记录位置不一致'
    }
  }

  return {
    ok: true,
    count: insertedCount,
    expectedCaret: expected
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
          on error
            return "MISMATCH|caret-unreadable"
          end try
          try
            set currentCaretLocation to (item 1 of currentSelection) as integer
            set currentCaretLength to (item 2 of currentSelection) as integer
          on error
            try
              set currentCaretLocation to (location of currentSelection) as integer
              set currentCaretLength to (length of currentSelection) as integer
            on error
              return "MISMATCH|caret-unreadable"
            end try
          end try
          if currentCaretLength is not 0 then return "MISMATCH|selection-active"
          if currentCaretLocation is not (expectedCaret as integer) then return "MISMATCH|caret-moved"
        end if
      end tell
      -- The caret location is verified once, before the first key. Inside the
      -- loop only the target identity and a collapsed selection are re-checked:
      -- one Backspace removes one grapheme, whose UTF-16 width may be greater
      -- than 1 (emoji, ZWJ sequences, flags), so a fixed "-1 per press" check
      -- would abort a perfectly valid deletion. The residual race is a user
      -- typing in the few-millisecond window between the pre-loop caret check
      -- and the last key; the per-key identity and collapsed-selection checks
      -- bound it but cannot eliminate it. Documented as a known limitation.
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
            if expectedCaret is not "" then
              -- Re-check only that the selection is still collapsed. The caret
              -- location is intentionally not asserted here: a grapheme can
              -- span several UTF-16 units. A non-zero length means the user
              -- started selecting; one more key could delete that selection.
              try
                set loopSelection to value of attribute "AXSelectedTextRange" of currentElement
              on error
                return "MISMATCH|caret-moved-mid-delete"
              end try
              try
                set loopLength to (item 2 of loopSelection) as integer
              on error
                try
                  set loopLength to (length of loopSelection) as integer
                on error
                  return "MISMATCH|caret-moved-mid-delete"
                end try
              end try
              if loopLength is not 0 then return "MISMATCH|selection-active-mid-delete"
            end if
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
    // A caller that has not verified a caret passes null, which tells the
    // script to skip the in-script caret check. The undo guard now always
    // verifies the caret (or refuses), so the empty value is only used by
    // direct callers and tests.
    expectedCaret === null ? '' : String(expectedCaret)
  ]
}

/**
 * The one fixed sentence for "the target changed before any key was pressed".
 * Every pre-key target-change path uses it verbatim.
 */
export const TARGET_SWITCHED_MESSAGE = '目标已切走，未回退'

/** The mid-delete variant: some keys may already have been pressed. */
export const TARGET_SWITCHED_MID_DELETE_MESSAGE =
  '删除过程中目标已切走，删除可能未完整完成'

const MISMATCH_MESSAGE: Record<string, string> = {
  'app-changed': TARGET_SWITCHED_MESSAGE,
  'bundle-changed': TARGET_SWITCHED_MESSAGE,
  'role-changed': TARGET_SWITCHED_MESSAGE,
  'identity-changed': TARGET_SWITCHED_MESSAGE,
  'unverifiable-target': TARGET_SWITCHED_MESSAGE,
  'not-editable': '焦点不再可编辑',
  'caret-moved': '插入点已改变，未回退',
  'selection-active': '当前有选区，未回退',
  'caret-unreadable': '无法确认插入位置，未回退',
  'app-changed-mid-delete': TARGET_SWITCHED_MID_DELETE_MESSAGE,
  'bundle-changed-mid-delete': TARGET_SWITCHED_MID_DELETE_MESSAGE,
  'role-changed-mid-delete': TARGET_SWITCHED_MID_DELETE_MESSAGE,
  'identity-changed-mid-delete': TARGET_SWITCHED_MID_DELETE_MESSAGE,
  'caret-moved-mid-delete': '删除过程中插入点已改变，删除可能未完整完成',
  'selection-active-mid-delete': '删除过程中出现选区，删除可能未完整完成',
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

/** A pre-key refusal caused by the target app/focus no longer being ours. */
const TARGET_SWITCH_REFUSALS = new Set([
  'app-changed',
  'bundle-changed',
  'role-changed',
  'identity-changed',
  'unverifiable-target'
])

/** A mid-delete abort caused by the target app/focus changing under us. */
const TARGET_SWITCH_MID_DELETE = new Set([
  'app-changed-mid-delete',
  'bundle-changed-mid-delete',
  'role-changed-mid-delete',
  'identity-changed-mid-delete'
])

export function isPreKeyRefusal(reason: string): boolean {
  return PRE_KEY_REFUSALS.has(reason)
}

export function isTargetSwitchRefusal(reason: string): boolean {
  return TARGET_SWITCH_REFUSALS.has(reason)
}

export function isTargetSwitchMidDelete(reason: string): boolean {
  return TARGET_SWITCH_MID_DELETE.has(reason)
}

/** The user-visible panel notice and returned message for a failed delete. */
export interface DeletionFailureNotice {
  /** True when keys may already have been pressed. */
  partial: boolean
  /** The exact panel notice. */
  notice: string
  /** The message returned to the session / IPC caller. */
  message: string
}

/**
 * One mapping for every deletion failure, so the target-switch sentence cannot
 * drift between the undo path, the re-say path and the result panel. A target
 * change before the first key is exactly 目标已切走，未回退; after a key it keeps
 * the "possibly incomplete" meaning instead.
 */
export function describeDeletionFailure(outcome: {
  reason: string
  message: string
}): DeletionFailureNotice {
  // `too-long` and `invalid-count` are decided in TypeScript before the
  // script starts, so no key was pressed either. They must not claim a
  // possibly incomplete deletion.
  const pressedNothing =
    isPreKeyRefusal(outcome.reason) ||
    outcome.reason === 'too-long' ||
    outcome.reason === 'invalid-count'
  const partial = !pressedNothing
  if (partial) {
    if (isTargetSwitchMidDelete(outcome.reason)) {
      return {
        partial: true,
        notice: TARGET_SWITCHED_MID_DELETE_MESSAGE,
        message: TARGET_SWITCHED_MID_DELETE_MESSAGE
      }
    }
    return {
      partial: true,
      notice: `删除可能未完整完成：${outcome.message}。请手动检查目标应用；原文备份在这里。`,
      message: `撤销可能未完整完成：${outcome.message}`
    }
  }
  if (isTargetSwitchRefusal(outcome.reason)) {
    return {
      partial: false,
      notice: TARGET_SWITCHED_MESSAGE,
      message: TARGET_SWITCHED_MESSAGE
    }
  }
  return {
    partial: false,
    notice: `${outcome.message}。未做自动删除；原文在这里，可复制。`,
    message: `撤销未完成：${outcome.message}`
  }
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
