import type { FocusTarget } from '../focus/editability'

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
  /** Grapheme cluster count, matching one Backspace per visible character. */
  length: number
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

export type UndoDecision =
  | { ok: true; count: number }
  | { ok: false; reason: UndoRefusalReason; message: string }

interface Segmenter {
  segment(input: string): Iterable<unknown>
}

/**
 * Count visible characters, not UTF-16 code units: macOS Backspace removes one
 * grapheme cluster, so a surrogate pair or a ZWJ emoji is one press.
 */
export function graphemeLength(text: string): number {
  if (text.length === 0) return 0
  const ctor = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => Segmenter })
    .Segmenter
  if (ctor !== undefined) {
    try {
      const segmenter = new ctor('zh', { granularity: 'grapheme' })
      let count = 0
      for (const _ of segmenter.segment(text)) count += 1
      return count
    } catch {
      // Fall through to code points on a runtime without grapheme data.
    }
  }
  return Array.from(text).length
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
    length: graphemeLength(input.text),
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
    // An empty identity can never pass the guard, so offering re-say would
    // only produce a guaranteed refusal.
    record.focusIdentity !== '' &&
    undoWindowOpen(record, nowMs, windowMs)
  )
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
  if (input.appFocused) {
    return {
      ok: false,
      reason: 'app-changed',
      message: '已切换到 JustSpeak，未做自动删除。'
    }
  }
  if (record.appName !== target.appName) {
    return {
      ok: false,
      reason: 'app-changed',
      message: '已切换目标应用，未做自动删除。'
    }
  }
  // Same visible app name is not enough: a helper or a different bundle can
  // share a name. Only refuse on a proven mismatch; an absent bundle id on
  // either side is already covered by the identity requirement below.
  if (
    record.bundleId !== null &&
    target.bundleId !== null &&
    record.bundleId !== target.bundleId
  ) {
    return {
      ok: false,
      reason: 'app-changed',
      message: '目标应用与插入时不一致，未做自动删除。'
    }
  }
  if (target.kind !== 'editable' || target.role !== record.focusRole) {
    return {
      ok: false,
      reason: 'focus-changed',
      message: '无法确认原来的输入位置，未做自动删除。'
    }
  }
  // Without a verifiable element identity the target cannot be distinguished
  // from another field with the same role in the same app. The owner's hard
  // rule: never auto-delete in that case, even when both sides are empty.
  if (record.focusIdentity === '' || target.identity === '') {
    return {
      ok: false,
      reason: 'unverifiable-target',
      message: '无法确认原来的输入位置，未做自动删除。'
    }
  }
  if (target.identity !== record.focusIdentity) {
    return {
      ok: false,
      reason: 'focus-changed',
      message: '焦点已改变，未做自动删除。'
    }
  }
  return { ok: true, count: record.length }
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
    case 'no-record':
      return '没有可撤销的插入'
  }
}
