/**
 * Incremental reader for the `chat.completions` SSE stream.
 *
 * The harness has to timestamp the *first* `delta.content` frame, so this keeps
 * only what is needed to find it: no message assembly, no token counting for
 * the finished text. Frames arrive split across chunk boundaries in practice,
 * so a buffer holds the tail of the current line until its newline arrives.
 *
 * Pure: no clock, no network. `measureFirstToken` in `llm.ts` owns the timing.
 */

export interface SseParseResult {
  /** Content fragments completed by this chunk, in arrival order. */
  contents: string[]
  /** True once a `[DONE]` sentinel was seen. */
  done: boolean
}

export class SseContentParser {
  private buffer = ''

  /** Feeds one decoded chunk; returns whatever completed inside it. */
  push(chunk: string): SseParseResult {
    this.buffer += chunk
    const contents: string[] = []
    let done = false
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      const payload = line.startsWith('data:') ? line.slice(5).trim() : ''
      if (payload === '[DONE]') {
        done = true
      } else if (payload.length > 0) {
        const content = readDeltaContent(payload)
        if (content !== null) contents.push(content)
      }
      newline = this.buffer.indexOf('\n')
    }
    return { contents, done }
  }
}

/**
 * Returns the delta text of one `data:` payload, or null for anything that is
 * not a content frame. Keep-alive comments and vendor-specific frames are not
 * errors; llama-server emits both.
 */
export function readDeltaContent(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>
    }
    const delta = parsed.choices?.[0]?.delta?.content
    if (typeof delta === 'string' && delta.length > 0) return delta
    return null
  } catch {
    return null
  }
}
