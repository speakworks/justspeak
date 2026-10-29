import { describe, expect, it } from 'vitest'
import { consumePendingNotice } from '../src/core/session/state-notice'

describe('pending segment failure notice', () => {
  it('is attached to the next idle state', () => {
    expect(consumePendingNotice('idle', undefined, '第 2 段（共 3 段）转写失败')).toEqual({
      message: '第 2 段（共 3 段）转写失败',
      pending: undefined
    })
  })

  it('survives every non-terminal state', () => {
    for (const state of ['recording', 'transcribing', 'pasting'] as const) {
      expect(consumePendingNotice(state, undefined, 'boom')).toEqual({
        message: undefined,
        pending: 'boom'
      })
    }
  })

  it('does not overwrite an error message but still consumes the notice', () => {
    expect(consumePendingNotice('error', '硬错误', 'boom')).toEqual({
      message: '硬错误',
      pending: undefined
    })
  })

  it('keeps an existing idle message when nothing is pending', () => {
    expect(consumePendingNotice('idle', '空闲', undefined)).toEqual({
      message: '空闲',
      pending: undefined
    })
  })
})
