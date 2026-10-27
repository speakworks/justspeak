import { describe, expect, it } from 'vitest'
import { parseAsrMode } from '../src/main/asr/mode'

describe('JUSTSPEAK_ASR mode parsing', () => {
  it('defaults to qwen3 when unset or explicitly qwen3', () => {
    expect(parseAsrMode(undefined)).toEqual({ ok: true, mode: 'qwen3' })
    expect(parseAsrMode('')).toEqual({ ok: true, mode: 'qwen3' })
    expect(parseAsrMode('qwen3')).toEqual({ ok: true, mode: 'qwen3' })
  })

  it('accepts fake only as an explicit test escape hatch', () => {
    expect(parseAsrMode('fake')).toEqual({ ok: true, mode: 'fake' })
  })

  it('fails closed on unknown values', () => {
    const result = parseAsrMode('cloud')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('qwen3')
  })
})
