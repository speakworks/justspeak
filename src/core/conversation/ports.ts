/**
 * SpeakPilot conversation ports (interfaces only).
 *
 * These ports describe capabilities, never implementations: a streaming ASR
 * port may be backed by Apple Speech, a local model, or a chunked wrapper over
 * the existing `AsrProvider`. Nothing here is wired into the running app —
 * the dictation path keeps using `src/core/asr/types.ts` untouched.
 *
 * Shapes follow `docs/SPEAKPILOT-CONVERSATION-PLAN.md` §c.2. Changing a shape
 * here means changing that document first.
 */

/** A single chat message. Kept minimal on purpose: the sidecar's OpenAI-compatible
 *  payload only needs role and content, and a richer type belongs with the
 *  conversation controller, not with the transport port. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/* ------------------------------------------------------------------ *
 * Streaming ASR
 * ------------------------------------------------------------------ */

export type AsrEvent =
  | { type: 'partial'; text: string }
  | { type: 'endpoint'; silenceMs: number }
  | { type: 'final'; text: string; startMs: number; endMs: number }

export interface StreamingAsrSession {
  /** Push one capture batch. Must not block; back-pressure is the caller's problem. */
  feed(chunk: Int16Array): void
  /** Ask for the final transcript; resolves after the terminal `final` event. */
  finish(): Promise<void>
  /** Drop the session without emitting a final event. Idempotent. */
  cancel(): void
  readonly events: AsyncIterable<AsrEvent>
}

export interface StreamingAsrPort {
  readonly capabilities: {
    languages: readonly string[]
    /** Whether `partial` events are produced before the final transcript. */
    partials: boolean
    maxSessionMs: number
  }
  open(options: { language: string }): Promise<StreamingAsrSession>
}

/* ------------------------------------------------------------------ *
 * Streaming chat
 * ------------------------------------------------------------------ */

export type ChatDelta =
  | { type: 'token'; text: string }
  | { type: 'done'; finishReason: 'stop' | 'length' | 'aborted' }

export interface ChatStreamPort {
  stream(
    messages: readonly ChatMessage[],
    options: { maxTokens: number; signal: AbortSignal }
  ): AsyncIterable<ChatDelta>
}

/* ------------------------------------------------------------------ *
 * Speech synthesis
 * ------------------------------------------------------------------ */

export type SpeechEvent =
  | { type: 'started' }
  | { type: 'boundary'; charRange: { location: number; length: number } }
  | { type: 'finished' }
  | { type: 'stopped' }

export interface SpeechHandle {
  readonly events: AsyncIterable<SpeechEvent>
  /** Stop speaking now; the stream ends with a `stopped` event, never `finished`. */
  stop(): void
}

export interface SpeechSynthesisPort {
  readonly voices: readonly {
    id: string
    language: string
    quality: 'compact' | 'enhanced' | 'premium'
  }[]
  speak(text: string, options: { voiceId?: string; rate?: number }): SpeechHandle
}

/* ------------------------------------------------------------------ *
 * Echo control
 * ------------------------------------------------------------------ */

export interface EchoProfileReport {
  /** What we asked the capture layer for. */
  requested: unknown
  /** What `getSettings()` read back. Never equal to `requested` by assumption. */
  effective: unknown
  warning?: string
}

export interface EchoControlPort {
  requestProfile(profile: 'dictation' | 'conversation'): Promise<EchoProfileReport>
}
