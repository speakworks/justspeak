import { describe, expect, it } from 'vitest'
import {
  EDITABLE_FOCUS_ROLES,
  parseFocusProbeLine
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
