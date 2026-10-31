import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASR_MODE,
  isSelectableAsrMode,
  parseAsrMode,
  parseAsrPreference,
  resolveAsrMode
} from '../src/main/asr/mode'

describe('JUSTSPEAK_ASR mode parsing', () => {
  it('defaults to sensevoice when unset or explicitly qwen3', () => {
    expect(parseAsrMode(undefined)).toEqual({ ok: true, mode: 'sensevoice' })
    expect(parseAsrMode('')).toEqual({ ok: true, mode: 'sensevoice' })
    expect(parseAsrMode('qwen3')).toEqual({ ok: true, mode: 'qwen3' })
    expect(DEFAULT_ASR_MODE).toBe('sensevoice')
  })

  it('accepts the second provider as an explicit mode', () => {
    expect(parseAsrMode('sensevoice')).toEqual({ ok: true, mode: 'sensevoice' })
  })

  it('accepts fake only as an explicit test escape hatch', () => {
    expect(parseAsrMode('fake')).toEqual({ ok: true, mode: 'fake' })
  })

  it('fails closed on unknown values', () => {
    const result = parseAsrMode('cloud')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('qwen3')
      expect(result.message).toContain('sensevoice')
    }
  })

  it('rejects fake as a persisted preference but keeps it selectable from env', () => {
    expect(parseAsrMode('fake').ok).toBe(true)
    const pref = parseAsrPreference('fake')
    expect(pref.ok).toBe(false)
    if (!pref.ok) expect(pref.message).toContain('fake')
  })

  it('treats only qwen3 and sensevoice as user-selectable ids', () => {
    expect(isSelectableAsrMode('qwen3')).toBe(true)
    expect(isSelectableAsrMode('sensevoice')).toBe(true)
    expect(isSelectableAsrMode('fake')).toBe(false)
    expect(isSelectableAsrMode('cloud')).toBe(false)
  })
})

describe('provider selection precedence', () => {
  it('defaults to sensevoice when neither env nor preference is set', () => {
    expect(resolveAsrMode({})).toEqual({ ok: true, mode: 'sensevoice' })
  })

  it('reads the persisted preference when the env var is unset', () => {
    expect(resolveAsrMode({ preference: 'sensevoice' })).toEqual({
      ok: true,
      mode: 'sensevoice'
    })
  })

  it('lets an explicit env var override the preference', () => {
    expect(resolveAsrMode({ env: 'qwen3', preference: 'sensevoice' })).toEqual({
      ok: true,
      mode: 'qwen3'
    })
  })

  it('fails visibly on an unknown persisted id instead of falling back to qwen3', () => {
    const result = resolveAsrMode({ preference: 'cloud' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('cloud')
  })
})
