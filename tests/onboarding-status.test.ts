import { describe, expect, it } from 'vitest'
import {
  describeAccessibility,
  describeMicrophone
} from '../src/core/onboarding/status'

describe('first-run permission wording', () => {
  it('marks granted Accessibility as usable for automatic paste', () => {
    const line = describeAccessibility(true)
    expect(line.tone).toBe('ok')
    expect(line.label).toBe('已授权')
    expect(line.hint).toContain('自动粘贴')
  })

  it('explains the copy-panel fallback when Accessibility is missing', () => {
    const line = describeAccessibility(false)
    expect(line.tone).toBe('warn')
    expect(line.hint).toContain('复制面板')
    expect(line.hint).toContain('辅助功能')
  })

  it('distinguishes a pending microphone prompt from a refusal', () => {
    expect(describeMicrophone('not-determined')).toMatchObject({
      tone: 'warn',
      label: '尚未询问'
    })
    expect(describeMicrophone('denied')).toMatchObject({ tone: 'bad', label: '已拒绝' })
    expect(describeMicrophone('restricted')).toMatchObject({
      tone: 'bad',
      label: '受限制'
    })
    expect(describeMicrophone('granted')).toMatchObject({ tone: 'ok', label: '已授权' })
    expect(describeMicrophone('unknown')).toMatchObject({
      tone: 'warn',
      label: '状态未知'
    })
  })
})
