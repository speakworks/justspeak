import { describe, expect, it } from 'vitest'
import type {
  AsrEvent,
  ChatDelta,
  ChatMessage,
  ChatStreamPort,
  EchoControlPort,
  EchoProfileReport,
  SpeechEvent,
  SpeechHandle,
  SpeechSynthesisPort,
  StreamingAsrPort,
  StreamingAsrSession
} from '../src/core/conversation/ports'

/* ---------------------------------------------------------------- *
 * Deterministic stubs. None of these touch the app runtime; they exist
 * to prove the port contracts can be implemented and consumed in tests.
 * ---------------------------------------------------------------- */

function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  return (async () => {
    const out: T[] = []
    for await (const item of stream) out.push(item)
    return out
  })()
}

function scriptedAsrPort(): StreamingAsrPort {
  return {
    capabilities: { languages: ['zh'], partials: true, maxSessionMs: 300_000 },
    async open(): Promise<StreamingAsrSession> {
      const queue: AsrEvent[] = []
      let resolveNext: ((v: IteratorResult<AsrEvent>) => void) | null = null
      let closed = false

      const push = (event: AsrEvent): void => {
        if (closed) return
        if (resolveNext) {
          const resolve = resolveNext
          resolveNext = null
          resolve({ value: event, done: false })
        } else {
          queue.push(event)
        }
      }

      const events: AsyncIterable<AsrEvent> = {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<AsrEvent>> {
              const queued = queue.shift()
              if (queued) return Promise.resolve({ value: queued, done: false })
              if (closed) return Promise.resolve({ value: undefined, done: true })
              return new Promise((resolve) => {
                resolveNext = resolve
              })
            }
          }
        }
      }

      return {
        feed(chunk: Int16Array) {
          push({ type: 'partial', text: `${chunk.length}` })
        },
        finish() {
          push({ type: 'final', text: 'done', startMs: 0, endMs: 100 })
          closed = true
          if (resolveNext) {
            const resolve = resolveNext
            resolveNext = null
            resolve({ value: undefined, done: true })
          }
          return Promise.resolve()
        },
        cancel() {
          if (closed) return
          closed = true
          queue.length = 0
          if (resolveNext) {
            const resolve = resolveNext
            resolveNext = null
            resolve({ value: undefined, done: true })
          }
        },
        events
      }
    }
  }
}

function scriptedChatPort(): ChatStreamPort {
  return {
    async *stream(
      messages: readonly ChatMessage[],
      options: { maxTokens: number; signal: AbortSignal }
    ): AsyncIterable<ChatDelta> {
      yield { type: 'token', text: `n=${messages.length}` }
      yield { type: 'token', text: `m=${options.maxTokens}` }
      if (options.signal.aborted) {
        yield { type: 'done', finishReason: 'aborted' }
        return
      }
      yield { type: 'done', finishReason: 'stop' }
    }
  }
}

function scriptedSpeechPort(): SpeechSynthesisPort {
  return {
    voices: [{ id: 'zh-tingting', language: 'zh-CN', quality: 'enhanced' }],
    speak(text: string): SpeechHandle {
      const events: SpeechEvent[] = [
        { type: 'started' },
        { type: 'boundary', charRange: { location: 0, length: Math.min(2, text.length) } },
        { type: 'finished' }
      ]
      let pendingStop = false
      let index = 0
      return {
        events: {
          [Symbol.asyncIterator]() {
            return {
              next(): Promise<IteratorResult<SpeechEvent>> {
                if (pendingStop) {
                  pendingStop = false
                  index = events.length
                  return Promise.resolve({ value: { type: 'stopped' }, done: false })
                }
                if (index >= events.length) {
                  return Promise.resolve({ value: undefined, done: true })
                }
                return Promise.resolve({ value: events[index++], done: false })
              }
            }
          }
        },
        stop() {
          pendingStop = true
        }
      }
    }
  }
}

function scriptedEchoPort(): EchoControlPort {
  return {
    async requestProfile(profile): Promise<EchoProfileReport> {
      if (profile === 'conversation') {
        return { requested: 'all', effective: 'all' }
      }
      return { requested: false, effective: false }
    }
  }
}

/* ---------------------------------------------------------------- *
 * Contract tests
 * ---------------------------------------------------------------- */

describe('StreamingAsrPort contract', () => {
  it('reports capabilities and opens a session for a supported language', async () => {
    const port = scriptedAsrPort()
    expect(port.capabilities.languages).toContain('zh')
    const session = await port.open({ language: 'zh' })
    expect(session).toBeDefined()
  })

  it('emits partials from feed and a final after finish', async () => {
    const session = await scriptedAsrPort().open({ language: 'zh' })
    const collected = collect(session.events)
    session.feed(new Int16Array(320))
    await session.finish()
    await expect(collected).resolves.toEqual([
      { type: 'partial', text: '320' },
      { type: 'final', text: 'done', startMs: 0, endMs: 100 }
    ])
  })

  it('cancel is idempotent and suppresses later events', async () => {
    const session = await scriptedAsrPort().open({ language: 'zh' })
    const collected = collect(session.events)
    session.cancel()
    session.cancel()
    session.feed(new Int16Array(160))
    await expect(collected).resolves.toEqual([])
  })
})

describe('ChatStreamPort contract', () => {
  it('streams tokens in order and ends with a done delta', async () => {
    const deltas = await collect(
      scriptedChatPort().stream([{ role: 'user', content: 'hi' }], {
        maxTokens: 16,
        signal: new AbortController().signal
      })
    )
    expect(deltas).toEqual([
      { type: 'token', text: 'n=1' },
      { type: 'token', text: 'm=16' },
      { type: 'done', finishReason: 'stop' }
    ])
  })

  it('reports aborted when the caller cancels mid-stream', async () => {
    const controller = new AbortController()
    controller.abort()
    const deltas = await collect(
      scriptedChatPort().stream([], { maxTokens: 8, signal: controller.signal })
    )
    expect(deltas.at(-1)).toEqual({ type: 'done', finishReason: 'aborted' })
  })
})

describe('SpeechSynthesisPort contract', () => {
  it('exposes voices and yields started, boundary, finished in order', async () => {
    const port = scriptedSpeechPort()
    expect(port.voices[0].language).toBe('zh-CN')
    const handle = port.speak('你好', { voiceId: 'zh-tingting', rate: 1 })
    const events: SpeechEvent[] = []
    for await (const event of handle.events) events.push(event)
    expect(events.map((e) => e.type)).toEqual(['started', 'boundary', 'finished'])
  })

  it('boundary carries a character range, not an audio timestamp', async () => {
    const handle = scriptedSpeechPort().speak('你好世界', {})
    const events: SpeechEvent[] = []
    for await (const event of handle.events) events.push(event)
    const boundary = events.find((e) => e.type === 'boundary')
    expect(boundary).toMatchObject({ charRange: { location: 0, length: 2 } })
  })
})

describe('EchoControlPort contract', () => {
  it('returns the read-back value alongside the requested one', async () => {
    const report = await scriptedEchoPort().requestProfile('conversation')
    expect(report.requested).toBe('all')
    expect(report.effective).toBe('all')
  })

  it('can report a warning when effective differs from requested', async () => {
    const port: EchoControlPort = {
      async requestProfile() {
        return { requested: 'all', effective: false, warning: 'AEC 未生效：系统权限不足' }
      }
    }
    const report = await port.requestProfile('conversation')
    expect(report.effective).toBe(false)
    expect(report.warning).toContain('AEC')
  })
})
