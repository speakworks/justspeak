## Why

SpeakPilot needs streaming ASR, streaming chat, on-device speech synthesis and
echo control before any conversation code can be written against them. The plan
(`docs/SPEAKPILOT-CONVERSATION-PLAN.md` §c.2) sketches four ports, but nothing
in the repository expresses them yet, so there is no shared vocabulary and no
contract to test against. Every candidate implementation would otherwise invent
its own shapes, and the latency work would end up measuring slightly different
things.

This change lands the vocabulary only. It deliberately ships **no behaviour**:
the dictation path, the ASR providers, the renderer audio constraints and the
injection chain are untouched.

## What Changes

- **A new core module `src/core/conversation/ports.ts`** declaring
  `StreamingAsrPort` / `StreamingAsrSession` / `AsrEvent`, `ChatStreamPort` /
  `ChatDelta` / `ChatMessage`, `SpeechSynthesisPort` / `SpeechHandle` /
  `SpeechEvent`, and `EchoControlPort` / `EchoProfileReport`.
- **Shapes are frozen to the plan document.** `SpeechHandle` carries a
  `boundary` event whose payload is a character range (`location`, `length`),
  not an audio timestamp, because that is what `AVSpeechSynthesizer`'s
  `willSpeakRangeOfSpeechString` actually yields. `EchoProfileReport` carries
  `requested` and `effective` separately, because Chromium can read back
  `getSettings()` values that do not reflect what the OS granted.
- **Contract tests with deterministic stubs.** In-memory stubs implement each
  port and prove the four contracts: partials then final, ordered chat deltas
  ending in `done`, speech events in `started → boundary* → finished|stopped`
  order, and an echo report that never conflates requested with effective.
- **No runtime wiring.** No import from `src/main`, `src/renderer` or any
  existing provider; no UI switch; no version bump.

## Non-goals

- No streaming ASR implementation, and the existing `AsrProvider` contract
  (`src/core/asr/types.ts`) is not modified.
- No TTS engine work; the system synthesizer stays the only implementation.
- No AEC profile switch in the renderer.
- No change to the dictation session, injection, history or settings surfaces.
- No user-visible string mentions "实时对话"; that wording is gated behind
  Phase 0 measurements per the plan's degradation rules.
