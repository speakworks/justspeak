import { describe, expect, it } from 'vitest'
import {
  applyCorrectionAction,
  applyLlmDecision,
  correctWithLlm,
  findCorrectionCandidate,
  guardCorrection
} from '../src/core/llm/correction'

describe('correction candidate', () => {
  it('finds one marker set off by punctuation', () => {
    const candidate = findCorrectionCandidate('周一发，不对，周二发。')
    expect(candidate).not.toBeNull()
    expect(candidate?.ellipsisBoundary).toBe(false)
    expect(candidate?.clauseStart).toBe(0)
  })

  it('treats an ellipsis boundary as an ellipsis candidate', () => {
    const candidate = findCorrectionCandidate('他说……不对，走了')
    expect(candidate?.ellipsisBoundary).toBe(true)
  })

  it('ignores a marker inside a word', () => {
    expect(findCorrectionCandidate('这个不对。')).toBeNull()
    expect(findCorrectionCandidate('那个东西很好。')).toBeNull()
  })

  it('defers when more than one marker is present', () => {
    expect(findCorrectionCandidate('先做A，然后B，不对，我是说C。')).toBeNull()
  })
})

describe('correction application', () => {
  it('deletes the abandoned clause when the model chose delete_before', () => {
    const text = '周一发，不对，周二发。'
    expect(applyLlmDecision(text, 'delete_before_keep_after').text).toBe('周二发。')
  })

  it('keeps the ellipsis and the quoted content at an ellipsis boundary', () => {
    const text = '他说……不对，走了'
    expect(applyLlmDecision(text, 'delete_before_keep_after').text).toBe('他说……走了')
  })

  it('deletes only the marker for marker-only actions', () => {
    const text = '周一发，不对，周二发。'
    expect(applyLlmDecision(text, 'delete_marker_only').text).toBe('周一发，周二发。')
  })

  it('returns the original for keep_all/defer and missing candidates', () => {
    expect(applyLlmDecision('周一发，不对，周二发。', 'keep_all').text).toBe('周一发，不对，周二发。')
    expect(applyLlmDecision('这个不对。', 'delete_before_keep_after').text).toBe('这个不对。')
  })

  it('never rewrites numbers', () => {
    const text = '3点开会，不对，是4点。'
    const candidate = findCorrectionCandidate(text)
    expect(candidate).not.toBeNull()
    if (!candidate) return
    const result = applyCorrectionAction(text, candidate, 'delete_before_keep_after')
    expect(guardCorrection(text, result).ok).toBe(false)
    expect(applyLlmDecision(text, 'delete_before_keep_after').text).toBe(text)
  })

  it('guards full-width digits as well as ASCII digits', () => {
    const text = '３点开会，不对，是４点。'
    const candidate = findCorrectionCandidate(text)
    expect(candidate).not.toBeNull()
    if (!candidate) return
    const result = applyCorrectionAction(text, candidate, 'delete_before_keep_after')
    expect(guardCorrection(text, result).ok).toBe(false)
  })

  it('fails closed for an action outside the closed vocabulary', () => {
    const text = '周一发，不对，周二发。'
    expect(applyCorrectionAction(text, findCorrectionCandidate(text)!, 'rewrite' as never)).toBe(text)
  })
})

describe('llm stage', () => {
  it('returns unchanged when the decision is null', async () => {
    expect(await correctWithLlm('周一发，不对，周二发。', async () => null)).toMatchObject({
      text: '周一发，不对，周二发。',
      applied: []
    })
  })

  it('applies a decision and reports the llm rule', async () => {
    const result = await correctWithLlm('周一发，不对，周二发。', async () => 'delete_before_keep_after')
    expect(result).toEqual({
      text: '周二发。',
      applied: ['llm'],
      corrected: true,
      outcome: 'applied'
    })
  })

  it('distinguishes a deferral from a keep-all decision', async () => {
    const deferred = await correctWithLlm('周一发，不对，周二发。', async () => null)
    expect(deferred.outcome).toBe('deferred')
    const kept = await correctWithLlm('周一发，不对，周二发。', async () => 'keep_all')
    expect(kept.outcome).toBe('keep_all')
  })

  it('never throws when the decision rejects', async () => {
    const result = await correctWithLlm('周一发，不对，周二发。', async () => {
      throw new Error('timeout')
    })
    expect(result).toMatchObject({ text: '周一发，不对，周二发。', applied: [] })
  })
})
