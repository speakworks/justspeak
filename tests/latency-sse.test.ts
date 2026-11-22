import { describe, expect, it } from 'vitest'
import { SseContentParser, readDeltaContent } from '../scripts/latency-harness/sse'

function frame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

describe('SseContentParser', () => {
  it('returns the content of a completed frame', () => {
    const parser = new SseContentParser()
    expect(parser.push(frame('你')).contents).toEqual(['你'])
  })

  it('reassembles a frame split across chunk boundaries', () => {
    const parser = new SseContentParser()
    const full = frame('明天')
    const first = parser.push(full.slice(0, 12))
    expect(first.contents).toEqual([])
    expect(parser.push(full.slice(12)).contents).toEqual(['明天'])
  })

  it('reports several frames from one chunk in order', () => {
    const parser = new SseContentParser()
    const result = parser.push(`${frame('a')}${frame('b')}${frame('c')}`)
    expect(result.contents).toEqual(['a', 'b', 'c'])
  })

  it('ignores keep-alive comments and non-content frames', () => {
    const parser = new SseContentParser()
    const result = parser.push(': ping\n\ndata: {"choices":[{"delta":{}}]}\n\ndata: not-json\n\n')
    expect(result.contents).toEqual([])
  })

  it('signals [DONE]', () => {
    const parser = new SseContentParser()
    const result = parser.push(`data: [DONE]\n\n`)
    expect(result.done).toBe(true)
    expect(result.contents).toEqual([])
  })

  it('ignores an empty content string', () => {
    expect(readDeltaContent(JSON.stringify({ choices: [{ delta: { content: '' } }] }))).toBeNull()
  })

  it('accepts a trailing carriage return', () => {
    const parser = new SseContentParser()
    expect(parser.push(`${frame('好')}\r\n`).contents).toEqual(['好'])
  })
})
