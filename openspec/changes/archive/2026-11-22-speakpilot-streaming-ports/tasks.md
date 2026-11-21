# speakpilot-streaming-ports Tasks

## 1. OpenSpec

- [x] 1.1 `proposal.md` records the four ports, the two frozen shape decisions
      (character-range boundaries, requested vs effective echo values) and the
      non-goals
- [x] 1.2 `specs/conversation-ports/spec.md` states the ASR, chat, speech,
      echo and not-wired requirements with scenarios
- [x] 1.3 `openspec validate speakpilot-streaming-ports --strict` passes

## 2. Port module (`src/core/conversation/ports.ts`)

- [x] 2.1 Declare `AsrEvent`, `StreamingAsrSession`, `StreamingAsrPort`
- [x] 2.2 Declare `ChatMessage`, `ChatDelta`, `ChatStreamPort`
- [x] 2.3 Declare `SpeechEvent`, `SpeechHandle`, `SpeechSynthesisPort`
- [x] 2.4 Declare `EchoProfileReport`, `EchoControlPort`
- [x] 2.5 No runtime imports from `src/main` / `src/renderer`; no side effects

## 3. Contract tests (`tests/speakpilot-ports.test.ts`)

- [x] 3.1 Scripted ASR stub: partials then final, cancel suppresses final
- [x] 3.2 Scripted chat stub: token order, done reason, pre-aborted signal
- [x] 3.3 Scripted speech stub: started → boundary → finished, boundary carries
      a character range
- [x] 3.4 Scripted echo stub: requested and effective kept separate, warning path
- [x] 3.5 `pnpm exec vitest run` passes with no drop in the existing totals

## 4. Gates

- [x] 4.1 `pnpm typecheck` passes
- [x] 4.2 Full suite counts reported honestly (passed / skipped / files)
- [x] 4.3 No file outside this change's scope (ports module, its test, this
      change directory) appears in the diff
