import { describe, expect, it } from 'vitest'
import {
  DELETE_SCRIPT,
  MAX_UNDO_CHARS,
  TARGET_SWITCHED_MESSAGE,
  TARGET_SWITCHED_MID_DELETE_MESSAGE,
  buildDeleteArgs,
  describeDeletionFailure,
  evaluateUndoCaret,
  isPreKeyRefusal,
  isTargetSwitchMidDelete,
  isTargetSwitchRefusal,
  parseDeleteResult
} from '../src/core/injection/delete'

const EXPECTED = {
  appName: 'Safari',
  bundleId: 'com.apple.Safari',
  role: 'AXTextArea',
  identity: 'main-editor'
}

describe('atomic delete script arguments', () => {
  it('passes every expected value as a separate argv item', () => {
    expect(buildDeleteArgs(EXPECTED, 42)).toEqual([
      '-e',
      DELETE_SCRIPT,
      'Safari',
      'com.apple.Safari',
      'AXTextArea',
      'main-editor',
      '42',
      ''
    ])
  })

  it('passes the verified caret as an argument, and an empty value to skip it', () => {
    expect(buildDeleteArgs(EXPECTED, 3, 17).slice(2)).toEqual([
      'Safari',
      'com.apple.Safari',
      'AXTextArea',
      'main-editor',
      '3',
      '17'
    ])
  })

  it('passes an absent bundle as an empty argument, not a shell fragment', () => {
    expect(buildDeleteArgs({ ...EXPECTED, bundleId: null }, 3).slice(2)).toEqual([
      'Safari',
      '',
      'AXTextArea',
      'main-editor',
      '3',
      ''
    ])
  })

  it('reads the count and expectations from argv, never interpolated text', () => {
    expect(DELETE_SCRIPT).toContain('on run argv')
    expect(DELETE_SCRIPT).toContain('item 5 of argv')
    expect(DELETE_SCRIPT).toContain('item 6 of argv')
    expect(DELETE_SCRIPT).not.toMatch(/repeat\s+\d+\s+times/)
  })

  it('aborts on every mismatch before the key loop', () => {
    const firstPress = DELETE_SCRIPT.indexOf('repeat with pressIndex')
    expect(firstPress).toBeGreaterThan(0)
    for (const outcome of [
      'return "MISMATCH|unverifiable-target"',
      'return "MISMATCH|app-changed"',
      'return "MISMATCH|bundle-changed"',
      'return "MISMATCH|role-changed"',
      'return "MISMATCH|not-editable"',
      'return "MISMATCH|identity-changed"',
      'return "MISMATCH|caret-unreadable"',
      'return "MISMATCH|selection-active"',
      'return "MISMATCH|caret-moved"'
    ]) {
      expect(DELETE_SCRIPT.indexOf(outcome), outcome).toBeGreaterThan(-1)
      expect(DELETE_SCRIPT.indexOf(outcome), outcome).toBeLessThan(firstPress)
    }
    expect(DELETE_SCRIPT.slice(firstPress)).toContain('key code 51')
  })
  it('rechecks app, bundle, role, identity and caret inside every key iteration', () => {
    const loop = DELETE_SCRIPT.slice(DELETE_SCRIPT.indexOf('repeat with pressIndex'))
    for (const check of [
      'app-changed-mid-delete',
      'bundle-changed-mid-delete',
      'role-changed-mid-delete',
      'identity-changed-mid-delete',
      'caret-moved-mid-delete',
      'mid-delete-error'
    ]) {
      expect(loop, check).toContain(check)
    }
    expect(loop).toContain('key code 51')
  })

  it('supports both AXSelectedTextRange shapes for the in-script caret', () => {
    for (const shape of ['item 1 of currentSelection', 'location of currentSelection']) {
      expect(DELETE_SCRIPT).toContain(shape)
    }
    expect(DELETE_SCRIPT).toContain('item 1 of loopSelection')
    expect(DELETE_SCRIPT).toContain('location of loopSelection')
  })
})

describe('atomic delete result', () => {
  it('reports success only for OK', () => {
    expect(parseDeleteResult('OK\n')).toEqual({ ok: true })
  })

  it('maps a mismatch to a refusal with a user-facing reason', () => {
    expect(parseDeleteResult('MISMATCH|app-changed\n')).toMatchObject({
      ok: false,
      reason: 'app-changed',
      message: '目标已切走，未回退'
    })
    expect(parseDeleteResult('MISMATCH|not-editable')).toMatchObject({
      ok: false,
      reason: 'not-editable',
      message: '焦点不再可编辑'
    })
  })

  it('reports mid-delete role/identity aborts as possibly incomplete', () => {
    for (const reason of [
      'role-changed-mid-delete',
      'identity-changed-mid-delete',
      'bundle-changed-mid-delete',
      'caret-moved-mid-delete',
      'mid-delete-error'
    ]) {
      const outcome = parseDeleteResult(`MISMATCH|${reason}`)
      expect(outcome.ok, reason).toBe(false)
      if (outcome.ok) continue
      expect(outcome.reason, reason).toBe(reason)
      expect(outcome.message, reason).toContain('可能未完整完成')
    }
  })

  it('never reports an unknown or failing answer as success', () => {
    expect(parseDeleteResult('ERROR|boom')).toMatchObject({ ok: false, reason: 'error' })
    expect(parseDeleteResult('')).toMatchObject({ ok: false, reason: 'unknown' })
    expect(parseDeleteResult('garbage')).toMatchObject({ ok: false, reason: 'unknown' })
  })

  it('maps the caret refusals to named user-facing text', () => {
    expect(parseDeleteResult('MISMATCH|caret-moved')).toMatchObject({
      ok: false,
      message: '插入点已改变，未回退'
    })
    expect(parseDeleteResult('MISMATCH|selection-active')).toMatchObject({
      ok: false,
      message: '当前有选区，未回退'
    })
    expect(parseDeleteResult('MISMATCH|caret-unreadable')).toMatchObject({
      ok: false,
      message: '无法确认插入位置，未回退'
    })
  })

  it('maps every pre-key target change to exactly 目标已切走，未回退', () => {
    for (const reason of [
      'app-changed',
      'bundle-changed',
      'role-changed',
      'identity-changed',
      'unverifiable-target'
    ]) {
      const outcome = parseDeleteResult(`MISMATCH|${reason}`)
      expect(outcome.ok, reason).toBe(false)
      if (outcome.ok) continue
      expect(isTargetSwitchRefusal(reason), reason).toBe(true)
      expect(outcome.message, reason).toBe(TARGET_SWITCHED_MESSAGE)
      expect(describeDeletionFailure(outcome).notice, reason).toBe(
        TARGET_SWITCHED_MESSAGE
      )
      expect(describeDeletionFailure(outcome).message, reason).toBe(
        TARGET_SWITCHED_MESSAGE
      )
    }
  })

  it('keeps the mid-delete target-switch sentence and partial meaning', () => {
    expect(TARGET_SWITCHED_MID_DELETE_MESSAGE).toBe(
      '删除过程中目标已切走，删除可能未完整完成'
    )
    for (const reason of [
      'app-changed-mid-delete',
      'bundle-changed-mid-delete',
      'role-changed-mid-delete',
      'identity-changed-mid-delete'
    ]) {
      const outcome = parseDeleteResult(`MISMATCH|${reason}`)
      expect(outcome.ok, reason).toBe(false)
      if (outcome.ok) continue
      expect(isTargetSwitchMidDelete(reason), reason).toBe(true)
      expect(outcome.message, reason).toBe(TARGET_SWITCHED_MID_DELETE_MESSAGE)
      const failure = describeDeletionFailure(outcome)
      expect(failure.partial, reason).toBe(true)
      expect(failure.notice, reason).toBe(TARGET_SWITCHED_MID_DELETE_MESSAGE)
      expect(failure.message, reason).toBe(TARGET_SWITCHED_MID_DELETE_MESSAGE)
    }
  })

  it('distinguishes pre-key aborts from a mid-delete abort', () => {
    expect(isPreKeyRefusal('app-changed')).toBe(true)
    expect(isPreKeyRefusal('identity-changed')).toBe(true)
    expect(isPreKeyRefusal('role-changed')).toBe(true)
    expect(isPreKeyRefusal('caret-moved')).toBe(true)
    expect(isPreKeyRefusal('selection-active')).toBe(true)
    expect(isPreKeyRefusal('caret-unreadable')).toBe(true)
    expect(isPreKeyRefusal('app-changed-mid-delete')).toBe(false)
    expect(isPreKeyRefusal('role-changed-mid-delete')).toBe(false)
    expect(isPreKeyRefusal('identity-changed-mid-delete')).toBe(false)
    expect(isPreKeyRefusal('mid-delete-error')).toBe(false)
    expect(isPreKeyRefusal('exec-failed')).toBe(false)
    expect(isPreKeyRefusal('error')).toBe(false)
  })
})

describe('the undo caret decision', () => {
  const EXPECTATION = {
    insertionStart: 10,
    selectionLengthBefore: 0,
    insertedCount: 4,
    caretAdvance: 4
  }

  it('deletes the recorded span only when the caret is collapsed at its end', () => {
    expect(
      evaluateUndoCaret({ expectation: EXPECTATION, current: { location: 14, length: 0 } })
    ).toEqual({
      ok: true,
      count: 4,
      expectedCaret: 14
    })
  })

  it('accounts for a replaced selection: the caret still lands at P0 + advance', () => {
    expect(
      evaluateUndoCaret({
        expectation: { ...EXPECTATION, selectionLengthBefore: 3 },
        current: { location: 14, length: 0 }
      })
    ).toMatchObject({ ok: true, count: 4, expectedCaret: 14 })
  })

  it('refuses when the user typed after the insertion', () => {
    expect(
      evaluateUndoCaret({ expectation: EXPECTATION, current: { location: 16, length: 0 } })
    ).toMatchObject({ ok: false, reason: 'caret-moved', message: '插入点已改变，未回退' })
  })

  it('refuses when text is selected', () => {
    expect(
      evaluateUndoCaret({ expectation: EXPECTATION, current: { location: 14, length: 2 } })
    ).toMatchObject({ ok: false, reason: 'selection-active' })
  })

  it('refuses and sends no key when the current caret is unreadable', () => {
    expect(evaluateUndoCaret({ expectation: EXPECTATION, current: null })).toEqual({
      ok: false,
      reason: 'caret-unverified',
      message: '无法确认插入位置，未回退',
      note: '撤销被拒绝：无法读取当前插入点'
    })
  })

  it('refuses and sends no key when the insertion point was never read', () => {
    const decision = evaluateUndoCaret({
      expectation: { ...EXPECTATION, insertionStart: null },
      current: { location: 14, length: 0 }
    })
    expect(decision).toEqual({
      ok: false,
      reason: 'caret-unverified',
      message: '无法确认插入位置，未回退',
      note: '撤销被拒绝：插入时未读到插入点'
    })
    // A refusal has no count, so no Backspace can be derived from it.
    expect('count' in decision).toBe(false)
  })

  it('refuses an active selection before any unreadable-insertion shortcut', () => {
    // Reproduction: insertionStart unknown + a 300-character selection. The
    // old order returned a deletable decision and the first Backspace wiped the
    // whole selection. Selection-active must win.
    const decision = evaluateUndoCaret({
      expectation: { ...EXPECTATION, insertionStart: null },
      current: { location: 12, length: 300 }
    })
    expect(decision).toMatchObject({
      ok: false,
      reason: 'selection-active',
      message: '当前有选区，未回退'
    })
    expect('count' in decision).toBe(false)
  })

  it('refuses any count above the fixed 500-character cap', () => {
    expect(MAX_UNDO_CHARS).toBe(500)
    expect(
      evaluateUndoCaret({
        expectation: { ...EXPECTATION, insertedCount: 500, caretAdvance: 500 },
        current: { location: 510, length: 0 }
      })
    ).toMatchObject({ ok: true, count: 500 })
    expect(
      evaluateUndoCaret({
        expectation: { ...EXPECTATION, insertedCount: 501, caretAdvance: 501 },
        current: { location: 511, length: 0 }
      })
    ).toMatchObject({ ok: false, reason: 'too-long' })
  })
})
