/**
 * The one place that talks to `llama-server` for a latency sample.
 *
 * Both entry points exist for the harness and the Phase 0 collector, which
 * measure the same thing on different text: time from request to first
 * `delta.content` frame (streaming) and time to a complete small completion
 * (non-streaming reference). Splitting them out of the bench script keeps a
 * single SSE parser — `SseContentParser` — in charge of what counts as a token.
 */
import type { ChatMessage } from '../../src/core/conversation/ports'
import { SseContentParser } from './sse'

export interface LlmTimingOptions {
  baseUrl: string
  apiKey: string
  messages: readonly ChatMessage[]
  maxTokens?: number
  temperature?: number
}

export interface StreamMeasurement {
  firstTokenMs: number
  totalMs: number
  tokens: number
}

/**
 * Returns null when the server answered with a non-event-stream body: that is
 * "streaming unsupported", not "first token at 0 ms", and the caller must
 * record it as unverified rather than as a measurement.
 */
export async function measureFirstToken(options: LlmTimingOptions): Promise<StreamMeasurement | null> {
  const started = performance.now()
  const response = await fetch(`${options.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
    body: JSON.stringify({
      model: 'local',
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 32,
      stream: true,
      messages: options.messages
    })
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  if (!response.body) throw new Error('no response body')
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    await response.text()
    return null
  }

  const parser = new SseContentParser()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let firstTokenMs: number | null = null
  let tokens = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      const parsed = parser.push(decoder.decode(chunk.value, { stream: true }))
      for (const _content of parsed.contents) {
        tokens += 1
        if (firstTokenMs === null) firstTokenMs = performance.now() - started
      }
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }
  if (firstTokenMs === null) return null
  return { firstTokenMs, totalMs: performance.now() - started, tokens }
}

export async function measureNonStreaming(options: LlmTimingOptions): Promise<number> {
  const started = performance.now()
  const response = await fetch(`${options.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
    body: JSON.stringify({
      model: 'local',
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 32,
      stream: false,
      messages: options.messages
    })
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  await response.json()
  return performance.now() - started
}
