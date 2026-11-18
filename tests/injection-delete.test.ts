import { describe, expect, it } from 'vitest'
import {
  DELETE_SCRIPT,
  buildDeleteArgs,
  isPreKeyRefusal,
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
      '42'
    ])
  })

  it('passes an absent bundle as an empty argument, not a shell fragment', () => {
    expect(buildDeleteArgs({ ...EXPECTED, bundleId: null }, 3).slice(2)).toEqual([
      'Safari',
      '',
      'AXTextArea',
      'main-editor',
      '3'
    ])
  })

  it('reads the count and expectations from argv, never interpolated text', () => {
    expect(DELETE_SCRIPT).toContain('on run argv')
    expect(DELETE_SCRIPT).toContain('item 5 of argv')
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
      'return "MISMATCH|identity-changed"'
    ]) {
      expect(DELETE_SCRIPT.indexOf(outcome), outcome).toBeGreaterThan(-1)
      expect(DELETE_SCRIPT.indexOf(outcome), outcome).toBeLessThan(firstPress)
    }
    expect(DELETE_SCRIPT.slice(firstPress)).toContain('key code 51')
  })
  it('rechecks app, bundle, role and identity inside every key iteration', () => {
    const loop = DELETE_SCRIPT.slice(DELETE_SCRIPT.indexOf('repeat with pressIndex'))
    for (const check of [
      'app-changed-mid-delete',
      'bundle-changed-mid-delete',
      'role-changed-mid-delete',
      'identity-changed-mid-delete',
      'mid-delete-error'
    ]) {
      expect(loop, check).toContain(check)
    }
    expect(loop).toContain('key code 51')
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
      message: '目标应用已改变'
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

  it('distinguishes pre-key aborts from a mid-delete abort', () => {
    expect(isPreKeyRefusal('app-changed')).toBe(true)
    expect(isPreKeyRefusal('identity-changed')).toBe(true)
    expect(isPreKeyRefusal('role-changed')).toBe(true)
    expect(isPreKeyRefusal('app-changed-mid-delete')).toBe(false)
    expect(isPreKeyRefusal('role-changed-mid-delete')).toBe(false)
    expect(isPreKeyRefusal('identity-changed-mid-delete')).toBe(false)
    expect(isPreKeyRefusal('mid-delete-error')).toBe(false)
    expect(isPreKeyRefusal('exec-failed')).toBe(false)
    expect(isPreKeyRefusal('error')).toBe(false)
  })
})
