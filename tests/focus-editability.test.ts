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
  it('reads the app, bundle, role and identity from the five-field probe', () => {
    const target = parseFocusProbeTarget(
      'Safari\ncom.apple.Safari\nAXTextArea\n1\nmain-editor\n'
    )
    expect(target).toEqual({
      kind: 'editable',
      appName: 'Safari',
      bundleId: 'com.apple.Safari',
      role: 'AXTextArea',
      identity: 'main-editor'
    })
  })

  it('keeps a non-editable role non-editable', () => {
    expect(
      parseFocusProbeTarget('Finder\ncom.apple.finder\nAXGroup\n1\n\n')
    ).toMatchObject({ kind: 'non-editable', appName: 'Finder', identity: '' })
  })

  it('accepts the legacy two-field answer without inventing an app identity', () => {
    expect(parseFocusProbeTarget('AXTextArea|1')).toEqual({
      kind: 'editable',
      appName: null,
      bundleId: null,
      role: 'AXTextArea',
      identity: ''
    })
  })

  it('reports unknown instead of guessing when the probe cannot answer', () => {
    for (const raw of ['UNKNOWN', '', 'garbage']) {
      expect(parseFocusProbeTarget(raw), raw).toMatchObject({
        kind: 'unknown',
        appName: null,
        role: null
      })
    }
  })
})
