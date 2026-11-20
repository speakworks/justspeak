import { describe, expect, it } from 'vitest'
import {
  EDITABLE_FOCUS_ROLES,
  parseFocusProbeLine,
  parseFocusProbeTarget
} from '../src/core/focus/editability'

describe('focus probe parsing', () => {
  it('accepts every editable role when a text range exists', () => {
    for (const role of EDITABLE_FOCUS_ROLES) {
      expect(parseFocusProbeLine(`${role}|1`)).toBe('editable')
    }
  })

  it('rejects a non-editable role even when it advertises a range', () => {
    // Finder's desktop (AXGroup) and Chrome's page surface (AXWebArea) both do.
    expect(parseFocusProbeLine('AXGroup|1')).toBe('non-editable')
    expect(parseFocusProbeLine('AXWebArea|1')).toBe('non-editable')
  })

  it('treats an editable role without a text range as non-editable', () => {
    expect(parseFocusProbeLine('AXTextArea|0')).toBe('non-editable')
  })

  it('treats an unreadable probe as unknown', () => {
    expect(parseFocusProbeLine('UNKNOWN')).toBe('unknown')
    expect(parseFocusProbeLine('')).toBe('unknown')
    expect(parseFocusProbeLine('AXTextArea')).toBe('unknown')
    expect(parseFocusProbeLine('|1')).toBe('unknown')
    expect(parseFocusProbeLine('AXTextArea|maybe')).toBe('unknown')
  })
})

describe('extended focus target parsing', () => {
  it('reads the selection range and identity from the seven-field probe', () => {
    const target = parseFocusProbeTarget(
      'Safari\ncom.apple.Safari\nAXTextArea\n1\n10\n2\nmain-editor\n'
    )
    expect(target).toEqual({
      kind: 'editable',
      appName: 'Safari',
      bundleId: 'com.apple.Safari',
      role: 'AXTextArea',
      identity: 'main-editor',
      selection: { location: 10, length: 2 }
    })
  })

  it('keeps the legacy five-field answer but reports no selection', () => {
    const target = parseFocusProbeTarget(
      'Safari\ncom.apple.Safari\nAXTextArea\n1\nmain-editor\n'
    )
    expect(target).toEqual({
      kind: 'editable',
      appName: 'Safari',
      bundleId: 'com.apple.Safari',
      role: 'AXTextArea',
      identity: 'main-editor',
      selection: null
    })
  })

  it('reports an unreadable selection as null, never as a fake zero', () => {
    const target = parseFocusProbeTarget(
      'Safari\ncom.apple.Safari\nAXTextArea\n1\nNONE\nNONE\nmain-editor\n'
    )
    expect(target).toMatchObject({ kind: 'editable', selection: null })
    // A real caret at 0 still parses as a real value.
    expect(
      parseFocusProbeTarget('Safari\ncom.apple.Safari\nAXTextArea\n1\n0\n0\nmain-editor\n')
        .selection
    ).toEqual({ location: 0, length: 0 })
  })

  it('keeps a non-editable role non-editable', () => {
    expect(
      parseFocusProbeTarget('Finder\ncom.apple.finder\nAXGroup\n1\n\n')
    ).toMatchObject({ kind: 'non-editable', appName: 'Finder', identity: '', selection: null })
  })

  it('accepts the legacy two-field answer without inventing an app identity', () => {
    expect(parseFocusProbeTarget('AXTextArea|1')).toEqual({
      kind: 'editable',
      appName: null,
      bundleId: null,
      role: 'AXTextArea',
      identity: '',
      selection: null
    })
  })

  it('reports unknown instead of guessing when the probe cannot answer', () => {
    for (const raw of ['UNKNOWN', '', 'garbage']) {
      expect(parseFocusProbeTarget(raw), raw).toMatchObject({
        kind: 'unknown',
        appName: null,
        role: null,
        selection: null
      })
    }
  })
})
