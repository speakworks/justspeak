import { describe, expect, it } from 'vitest'
import type { FocusTarget } from '../src/core/focus/editability'
import {
  DEFAULT_UNDO_WINDOW_MS,
  buildInjectionRecord,
  evaluateUndoGuard,
  graphemeLength,
  isReSayCandidate,
  isValidUndoWindowMinutes,
  undoRefusalTitle,
  undoWindowMs,
  undoWindowOpen,
  type InjectionRecord
} from '../src/core/injection/undo'

const TARGET: FocusTarget = {
  kind: 'editable',
  appName: 'Safari',
  bundleId: 'com.apple.Safari',
  role: 'AXTextArea',
  identity: 'main-editor'
}

function record(overrides: Partial<InjectionRecord> = {}): InjectionRecord {
  return {
    appName: 'Safari',
    bundleId: 'com.apple.Safari',
    focusRole: 'AXTextArea',
    focusIdentity: 'main-editor',
    text: '你好',
    length: 2,
    atMs: 1_000,
    method: 'paste',
    ...overrides
  }
}

describe('grapheme length', () => {
  it('counts CJK and latin characters one each', () => {
    expect(graphemeLength('你好')).toBe(2)
    expect(graphemeLength('hello')).toBe(5)
    expect(graphemeLength('你好，world')).toBe(8)
  })

  it('counts one visible character per emoji, not per UTF-16 unit', () => {
    expect(graphemeLength('😀')).toBe(1)
    expect(graphemeLength('👨‍👩‍👧‍👦')).toBe(1)
    expect(graphemeLength('🇨🇳')).toBe(1)
  })

  it('counts a combining sequence as one cluster and empty text as zero', () => {
    expect(graphemeLength('é')).toBe(1)
    expect(graphemeLength('')).toBe(0)
  })
})

describe('building an injection record', () => {
  it('records a paste with the target identity and grapheme count', () => {
    const built = buildInjectionRecord({
      text: '你好',
      atMs: 1_000,
      method: 'paste',
      target: TARGET
    })
    expect(built).toMatchObject({
      appName: 'Safari',
      bundleId: 'com.apple.Safari',
      focusRole: 'AXTextArea',
      focusIdentity: 'main-editor',
      text: '你好',
      length: 2,
      atMs: 1_000,
      method: 'paste'
    })
  })

  it('refuses to make a delete target out of a non-editable paste', () => {
    expect(
      buildInjectionRecord({
        text: '你好',
        atMs: 1_000,
        method: 'paste',
        target: { ...TARGET, kind: 'non-editable' }
      })
    ).toBeNull()
  })

  it('records a panel display but not an unreadable target', () => {
    expect(
      buildInjectionRecord({
        text: '你好',
        atMs: 1_000,
        method: 'panel',
        target: { ...TARGET, kind: 'non-editable' }
      })
    ).toMatchObject({ method: 'panel' })
    expect(
      buildInjectionRecord({
        text: '你好',
        atMs: 1_000,
        method: 'panel',
        target: { ...TARGET, kind: 'unknown', appName: null }
      })
    ).toBeNull()
  })

  it('ignores empty text', () => {
    expect(
      buildInjectionRecord({ text: '', atMs: 1_000, method: 'paste', target: TARGET })
    ).toBeNull()
  })
})

describe('the undo guard', () => {
  it('allows deletion only for the same editable target inside the window', () => {
    expect(
      evaluateUndoGuard({
        record: record(),
        nowMs: 2_000,
        windowMs: DEFAULT_UNDO_WINDOW_MS,
        appFocused: false,
        target: TARGET
      })
    ).toEqual({ ok: true, count: 2 })
  })

  it('refuses when no record exists', () => {
    const decision = evaluateUndoGuard({
      record: undefined,
      nowMs: 2_000,
      windowMs: DEFAULT_UNDO_WINDOW_MS,
      appFocused: false,
      target: TARGET
    })
    expect(decision).toMatchObject({ ok: false, reason: 'no-record' })
  })

  it('refuses after the window expired', () => {
    const decision = evaluateUndoGuard({
      record: record(),
      nowMs: 1_000 + DEFAULT_UNDO_WINDOW_MS + 1,
      windowMs: DEFAULT_UNDO_WINDOW_MS,
      appFocused: false,
      target: TARGET
    })
    expect(decision).toMatchObject({ ok: false, reason: 'expired' })
  })

  it('refuses when the record came from the panel', () => {
    const decision = evaluateUndoGuard({
      record: record({ method: 'panel' }),
      nowMs: 2_000,
      windowMs: DEFAULT_UNDO_WINDOW_MS,
      appFocused: false,
      target: TARGET
    })
    expect(decision).toMatchObject({ ok: false, reason: 'nothing-inserted' })
  })

  it('refuses when JustSpeak has focus', () => {
    const decision = evaluateUndoGuard({
      record: record(),
      nowMs: 2_000,
      windowMs: DEFAULT_UNDO_WINDOW_MS,
      appFocused: true,
      target: TARGET
    })
    expect(decision).toMatchObject({ ok: false, reason: 'app-changed' })
  })

  it('refuses when a different app is frontmost', () => {
    const decision = evaluateUndoGuard({
      record: record(),
      nowMs: 2_000,
      windowMs: DEFAULT_UNDO_WINDOW_MS,
      appFocused: false,
      target: { ...TARGET, appName: 'Notes' }
    })
    expect(decision).toMatchObject({ ok: false, reason: 'app-changed' })
  })

  it('refuses when the probe cannot confirm an editable element', () => {
    for (const kind of ['unknown', 'non-editable'] as const) {
      const decision = evaluateUndoGuard({
        record: record(),
        nowMs: 2_000,
        windowMs: DEFAULT_UNDO_WINDOW_MS,
        appFocused: false,
        target: { ...TARGET, kind }
      })
      expect(decision, kind).toMatchObject({ ok: false, reason: 'focus-changed' })
    }
  })

  it('refuses when the role changed inside the same app', () => {
    const decision = evaluateUndoGuard({
      record: record(),
      nowMs: 2_000,
      windowMs: DEFAULT_UNDO_WINDOW_MS,
      appFocused: false,
      target: { ...TARGET, role: 'AXTextField' }
    })
    expect(decision).toMatchObject({ ok: false, reason: 'focus-changed' })
  })

  it('refuses when the element identity changed', () => {
    const decision = evaluateUndoGuard({
      record: record(),
      nowMs: 2_000,
      windowMs: DEFAULT_UNDO_WINDOW_MS,
      appFocused: false,
      target: { ...TARGET, identity: 'other-editor' }
    })
    expect(decision).toMatchObject({ ok: false, reason: 'focus-changed' })
  })

  it('refuses automatic deletion when either side has no verifiable identity', () => {
    // The owner's hard rule: an empty identity cannot distinguish this field
    // from another same-role field in the same app, even when both are empty.
    for (const [recordIdentity, targetIdentity] of [
      ['', ''],
      ['', 'main-editor'],
      ['main-editor', '']
    ] as const) {
      const decision = evaluateUndoGuard({
        record: record({ focusIdentity: recordIdentity }),
        nowMs: 2_000,
        windowMs: DEFAULT_UNDO_WINDOW_MS,
        appFocused: false,
        target: { ...TARGET, identity: targetIdentity }
      })
      expect(decision, `${recordIdentity || '∅'}/${targetIdentity || '∅'}`).toMatchObject({
        ok: false,
        reason: 'unverifiable-target'
      })
    }
  })

  it('refuses when the app name matches but the bundle ids differ', () => {
    const decision = evaluateUndoGuard({
      record: record(),
      nowMs: 2_000,
      windowMs: DEFAULT_UNDO_WINDOW_MS,
      appFocused: false,
      target: { ...TARGET, bundleId: 'com.example.safari' }
    })
    expect(decision).toMatchObject({ ok: false, reason: 'app-changed' })
  })

  it('refuses when the clock moved backwards', () => {
    expect(undoWindowOpen(record({ atMs: 5_000 }), 4_000, DEFAULT_UNDO_WINDOW_MS)).toBe(false)
  })
})

describe('re-say candidacy', () => {
  it('accepts only a verifiable real paste inside the window', () => {
    expect(isReSayCandidate(record(), 2_000, DEFAULT_UNDO_WINDOW_MS)).toBe(true)
    expect(isReSayCandidate(record({ method: 'panel' }), 2_000, DEFAULT_UNDO_WINDOW_MS)).toBe(false)
    expect(
      isReSayCandidate(record(), 1_000 + DEFAULT_UNDO_WINDOW_MS + 1, DEFAULT_UNDO_WINDOW_MS)
    ).toBe(false)
    expect(isReSayCandidate(undefined, 2_000, DEFAULT_UNDO_WINDOW_MS)).toBe(false)
    // An empty identity can never pass the guard.
    expect(
      isReSayCandidate(record({ focusIdentity: '' }), 2_000, DEFAULT_UNDO_WINDOW_MS)
    ).toBe(false)
  })
})

describe('the undo window preference', () => {
  it('accepts whole minutes from 1 to 60 and rejects anything else', () => {
    expect(isValidUndoWindowMinutes(1)).toBe(true)
    expect(isValidUndoWindowMinutes(60)).toBe(true)
    expect(isValidUndoWindowMinutes(0)).toBe(false)
    expect(isValidUndoWindowMinutes(61)).toBe(false)
    expect(isValidUndoWindowMinutes(5.5)).toBe(false)
    expect(isValidUndoWindowMinutes('5')).toBe(false)
  })

  it('converts minutes to milliseconds with a safe fallback', () => {
    expect(undoWindowMs(10)).toBe(600_000)
    expect(undoWindowMs(0)).toBe(DEFAULT_UNDO_WINDOW_MS)
  })
})

describe('refusal titles', () => {
  it('names the reason instead of a generic failure', () => {
    expect(undoRefusalTitle('expired')).toContain('时间窗')
    expect(undoRefusalTitle('app-changed')).toContain('切换')
    expect(undoRefusalTitle('focus-changed')).toContain('焦点')
    expect(undoRefusalTitle('nothing-inserted')).toContain('插入')
    expect(undoRefusalTitle('unverifiable-target')).toContain('输入位置')
  })
})
