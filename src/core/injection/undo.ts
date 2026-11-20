import type { FocusTarget } from '../focus/editability'
import { MAX_UNDO_CHARS, TARGET_SWITCHED_MESSAGE, evaluateUndoCaret } from './delete'

// The fixed target-switch sentence lives with the delete outcome mapping so
// every path shares one string; re-exported here for the existing callers.
export { TARGET_SWITCHED_MESSAGE } from './delete'

/**
 * The correction path's pure rules.
 *
 * One insertion is remembered at a time. Every automatic deletion — B1 undo,
 * B2 re-say, and the result panel's reinsertion check — runs through
 * `evaluateUndoGuard`; there is deliberately no second implementation. The
 * function never decides to "try anyway": an unreadable probe is a refusal,
 * because a wrong Backspace deletes text in someone else's window.
 */

export const DEFAULT_UNDO_WINDOW_MINUTES = 5
export const MIN_UNDO_WINDOW_MINUTES = 1
export const MAX_UNDO_WINDOW_MINUTES = 60
export const DEFAULT_UNDO_WINDOW_MS = DEFAULT_UNDO_WINDOW_MINUTES * 60_000

export function isValidUndoWindowMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_UNDO_WINDOW_MINUTES &&
    value <= MAX_UNDO_WINDOW_MINUTES
  )
}

export function undoWindowMs(minutes: number): number {
  const safe = isValidUndoWindowMinutes(minutes) ? minutes : DEFAULT_UNDO_WINDOW_MINUTES
  return safe * 60_000
}

/** `paste` physically inserted text; `panel` only displayed it. */
export type InjectionMethod = 'paste' | 'panel'

export interface InjectionRecord {
  /** The history row written for this delivery, once it exists. */
  entryId?: string
  /** Frontmost app at insertion time. */
  appName: string
  bundleId: string | null
  /** AX role of the focused element at insertion time. */
  focusRole: string
  /** AXIdentifier or AXTitle, or '' when the element exposed neither. */
  focusIdentity: string
  text: string
  /**
   * Grapheme cluster count, matching one Backspace per visible character.
   * `null` when the runtime cannot segment graphemes: the deletion path refuses
   * rather than guessing with code points.
   */
  length: number | null
  /**
   * Caret location read before the paste. `null` when the probe could not read
   * `AXSelectedTextRange`; the guard then refuses (caret-unverified).
   */
  insertionStart: number | null
  /**
   * Selection length read before the paste. `null` when unreadable. A paste
   * replaces any selection, so the caret lands at the insertion point plus the
   * inserted advance; this value only proves the pre-paste range was read.
   */
  selectionLengthBefore: number | null
  atMs: number
  method: InjectionMethod
}

export type UndoRefusalReason =
  | 'no-record'
  | 'expired'
  | 'nothing-inserted'
  | 'app-changed'
  | 'focus-changed'
  | 'unverifiable-target'
  | 'unverifiable-identity'
  | 'unverifiable-length'
  | 'caret-moved'
  | 'selection-active'
  | 'caret-unverified'
  | 'too-long'

export type UndoDecision =
  | {
      ok: true
      count: number
      /** Verified caret location. */
      expectedCaret: number
    }
  | {
      ok: false
      reason: UndoRefusalReason
      message: string
      /** Diagnostic detail, for the caller's log. */
      note?: string
    }

interface Segmenter {
  segment(input: string): Iterable<unknown>
}

type SegmenterCtor = new (
  locale?: string,
  options?: { granularity: 'grapheme' }
) => Segmenter

/**
 * Count visible characters, not UTF-16 code units: macOS Backspace removes one
 * grapheme cluster, so a surrogate pair or a ZWJ emoji is one press.
 *
 * `ctor` is injectable so a test can simulate a runtime without
 * `Intl.Segmenter`. A `null` answer means the count is unknown; the delete path
 * refuses it instead of falling back to code points, which would undercount
 * combining sequences and over-delete.
 */
export function graphemeLengthStrict(
  text: string,
  ctor?: SegmenterCtor | null
): number | null {
  if (text.length === 0) return 0
  const Ctor =
    ctor === undefined
      ? (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter
      : ctor
  if (Ctor === undefined || Ctor === null) return null
  try {
    const segmenter = new Ctor('zh', { granularity: 'grapheme' })
    let count = 0
    for (const _ of segmenter.segment(text)) count += 1
    return count
  } catch {
    return null
  }
}

/**
 * Display-oriented count with a code-point fallback. The delete path must use
 * `graphemeLengthStrict`; this helper is only for non-destructive uses.
 */
export function graphemeLength(text: string): number {
  return graphemeLengthStrict(text) ?? Array.from(text).length
}

/**
 * Build the record for a delivery. A paste needs an editable target with an
 * app name; the panel record only needs enough identity to reinsert later, and
 * may legitimately be absent when the probe was `unknown`.
 */
export function buildInjectionRecord(input: {
  text: string
  atMs: number
  method: InjectionMethod
  target: FocusTarget
  entryId?: string
}): InjectionRecord | null {
  if (input.text.length === 0) return null
  const { target } = input
  if (target.appName === null || target.role === null) return null
  if (input.method === 'paste' && target.kind !== 'editable') return null
  return {
    ...(input.entryId === undefined ? {} : { entryId: input.entryId }),
    appName: target.appName,
    bundleId: target.bundleId,
    focusRole: target.role,
    focusIdentity: target.identity,
    text: input.text,
    length: graphemeLengthStrict(input.text),
    insertionStart: target.selection?.location ?? null,
    selectionLengthBefore: target.selection?.length ?? null,
    atMs: input.atMs,
    method: input.method
  }
}

export function undoWindowOpen(
  record: InjectionRecord,
  nowMs: number,
  windowMs = DEFAULT_UNDO_WINDOW_MS
): boolean {
  const elapsed = nowMs - record.atMs
  return elapsed >= 0 && elapsed <= windowMs
}

/** True when a new recording should be treated as re-say for this record. */
export function isReSayCandidate(
  record: InjectionRecord | undefined,
  nowMs: number,
  windowMs = DEFAULT_UNDO_WINDOW_MS
): record is InjectionRecord {
  return (
    record !== undefined &&
    record.method === 'paste' &&
    // An empty identity, an unknown grapheme count, or a record above the hard
    // rollback cap can never pass the guard, so offering re-say would only
    // produce a guaranteed refusal.
    record.focusIdentity !== '' &&
    record.length !== null &&
    record.length <= MAX_UNDO_CHARS &&
    undoWindowOpen(record, nowMs, windowMs)
  )
}

/**
 * The identity comparison shared by undo and the result panel's reinsertion.
 * One implementation only: app, bundle (when both sides carry one), role, and
 * a non-empty element identity.
 */
export interface IdentityExpectation {
  appName: string | null
  bundleId: string | null
  role: string | null
  identity: string
}

export type IdentityRefusalReason =
  | 'app-changed'
  | 'focus-changed'
  | 'unverifiable-target'
  | 'unverifiable-identity'

export type IdentityDecision =
  | { ok: true }
  | { ok: false; reason: IdentityRefusalReason; message: string }

export function compareTargetIdentity(
  expected: IdentityExpectation,
  actual: IdentityExpectation
): IdentityDecision {
  if (expected.appName === null || actual.appName === null) {
    return {
      ok: false,
      reason: 'unverifiable-target',
      message: '无法确认原来的目标应用，未做自动删除。'
    }
  }
  if (expected.appName !== actual.appName) {
    return { ok: false, reason: 'app-changed', message: '已切换目标应用，未做自动删除。' }
  }
  // Same visible app name is not enough: a helper or a different bundle can
  // share a name.
  if (
    expected.bundleId !== null &&
    actual.bundleId !== null &&
    expected.bundleId !== actual.bundleId
  ) {
    return {
      ok: false,
      reason: 'app-changed',
      message: '目标应用与插入时不一致，未做自动删除。'
    }
  }
  if (expected.role === null || actual.role === null) {
    return {
      ok: false,
      reason: 'focus-changed',
      message: '无法确认原来的输入位置，未做自动删除。'
    }
  }
  if (expected.role !== actual.role) {
    return { ok: false, reason: 'focus-changed', message: '焦点已改变，未做自动删除。' }
  }
  if (expected.identity === '' || actual.identity === '') {
    // The app, bundle and role all match: the target did not switch away, the
    // element simply exposes neither AXIdentifier nor AXTitle. That is not a
    // target change, so it gets its own wording instead of 目标已切走.
    return {
      ok: false,
      reason: 'unverifiable-identity',
      message: '无法确认原来的目标，未回退'
    }
  }
  if (expected.identity !== actual.identity) {
    return { ok: false, reason: 'focus-changed', message: '焦点已改变，未做自动删除。' }
  }
  return { ok: true }
}

/** Copy-action wording for the same identity reasons (no "delete" language). */
export function identityCopyMessage(reason: IdentityRefusalReason): string {
  switch (reason) {
    case 'app-changed':
      return '目标应用已改变'
    case 'focus-changed':
      return '焦点已改变'
    case 'unverifiable-target':
      return '无法确认原来的输入位置'
    case 'unverifiable-identity':
      return '无法确认原来的目标'
  }
}

/**
 * The result-panel notice for a re-say guard refusal.
 *
 * A target switch must be exactly the fixed sentence; appending "new text
 * inserted / old text here" would break that guarantee. The texts themselves
 * are still in the panel body and title, so nothing is lost.
 */
export function reSayFallbackNotice(input: {
  targetSwitched: boolean
  reasonText: string
  inserted: boolean
}): string {
  if (input.targetSwitched) return TARGET_SWITCHED_MESSAGE
  return input.inserted
    ? `${input.reasonText} 新文本已插入；上一条文本在这里，可复制。`
    : `${input.reasonText} 新文本无法插入，两段文本都在这里。`
}

/**
 * The single guard. Every branch is a refusal unless the probe positively
 * confirms the same editable target; there is no "best effort" delete.
 */
export function evaluateUndoGuard(input: {
  record: InjectionRecord | undefined
  nowMs: number
  windowMs: number
  appFocused: boolean
  target: FocusTarget
}): UndoDecision {
  const { record, target } = input
  if (record === undefined) {
    return { ok: false, reason: 'no-record', message: '没有可撤销的插入。' }
  }
  if (!undoWindowOpen(record, input.nowMs, input.windowMs)) {
    const minutes = Math.max(1, Math.round(input.windowMs / 60_000))
    return {
      ok: false,
      reason: 'expired',
      message: `已超过撤销时间窗（${minutes} 分钟），未做自动删除。`
    }
  }
  if (record.method !== 'paste') {
    return {
      ok: false,
      reason: 'nothing-inserted',
      message: '上一条只显示在结果面板里，没有插入到任何应用。'
    }
  }
  if (record.length === null) {
    return {
      ok: false,
      reason: 'unverifiable-length',
      message: '无法安全计算要删除的字符数，未做自动删除。'
    }
  }
  if (input.appFocused) {
    return {
      ok: false,
      reason: 'app-changed',
      message: '已切换到 JustSpeak，未做自动删除。'
    }
  }
  const identity = compareTargetIdentity(
    {
      appName: record.appName,
      bundleId: record.bundleId,
      role: record.focusRole,
      identity: record.focusIdentity
    },
    target
  )
  if (!identity.ok) {
    return { ok: false, reason: identity.reason, message: identity.message }
  }
  if (target.kind !== 'editable') {
    return {
      ok: false,
      reason: 'focus-changed',
      message: '无法确认原来的输入位置，未做自动删除。'
    }
  }
  // The identity is the same field, but the user may still have typed or moved
  // the caret inside it. Only a collapsed caret at the end of our span may
  // delete; a moved caret, an active selection, or an unreadable caret refuses.
  const caret = evaluateUndoCaret({
    expectation: {
      insertionStart: record.insertionStart,
      selectionLengthBefore: record.selectionLengthBefore,
      insertedCount: record.length,
      caretAdvance: record.text.length
    },
    current: target.selection
  })
  if (!caret.ok) {
    return {
      ok: false,
      reason: caret.reason,
      message: caret.message,
      ...(caret.note === undefined ? {} : { note: caret.note })
    }
  }
  return {
    ok: true,
    count: caret.count,
    expectedCaret: caret.expectedCaret
  }
}

/** Panel title for a refusal, so the re-opened text explains itself. */
export function undoRefusalTitle(reason: UndoRefusalReason): string {
  switch (reason) {
    case 'expired':
      return '已超过撤销时间窗'
    case 'nothing-inserted':
      return '上一条未插入'
    case 'app-changed':
      return '已切换目标'
    case 'focus-changed':
      return '焦点已改变'
    case 'unverifiable-target':
      return '无法确认输入位置'
    case 'unverifiable-identity':
      return '无法确认原来的目标'
    case 'unverifiable-length':
      return '无法计算删除长度'
    case 'caret-moved':
      return '插入点已改变'
    case 'selection-active':
      return '当前有选区'
    case 'caret-unverified':
      return '无法确认插入位置'
    case 'too-long':
      return '超过回退上限'
    case 'no-record':
      return '没有可撤销的插入'
  }
}
