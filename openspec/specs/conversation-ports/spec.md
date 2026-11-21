# conversation-ports Specification

## Purpose

Define the vocabulary SpeakPilot's conversation path will be built against — streaming
ASR, streaming chat, speech synthesis and echo control — as interfaces with no
behaviour. The dictation path keeps using its own `AsrProvider` contract; these ports
sit beside it until a later change implements one of them behind its own gates.

## Requirements

### Requirement: The streaming ASR port SHALL expose capabilities and a cancellable session

The port SHALL declare, before any session is opened, the languages it accepts,
whether it produces partial transcripts, and the maximum session duration. A
session SHALL be cancellable at any time and cancellation SHALL be idempotent.
Cancellation SHALL NOT emit a terminal `final` event, so a cancelled session can
never be mistaken for a completed utterance.

Events SHALL arrive in a single order: zero or more `partial` events, then at
most one `final` event carrying `startMs` and `endMs`. An `endpoint` event MAY
appear between them and SHALL carry the silence duration that triggered it.

#### Scenario: Partials then a final

- **WHEN** a caller feeds capture batches and then calls `finish()`
- **THEN** the event stream yields the partials first
- **AND** the last event is a `final` whose `startMs` is not greater than its `endMs`

#### Scenario: Cancellation suppresses the final

- **WHEN** a caller calls `cancel()` twice and feeds one more batch
- **THEN** the event stream completes without a `final` event
- **AND** the second `cancel()` call does not throw

### Requirement: The chat stream port SHALL deliver deltas in order and terminate with a reason

The port SHALL accept an ordered message list and a `maxTokens` bound, and SHALL
honour an `AbortSignal`. Delivered deltas SHALL be `token` deltas followed by
exactly one `done` delta whose `finishReason` is `stop`, `length`, or `aborted`.

If the signal is already aborted, the stream SHALL terminate with `aborted` and
SHALL NOT emit tokens. The port SHALL NOT be responsible for prompt construction
or history trimming.

#### Scenario: Tokens then stop

- **WHEN** a caller streams a single user message with `maxTokens` 16
- **THEN** the tokens arrive in order
- **AND** the last delta is `{ type: 'done', finishReason: 'stop' }`

#### Scenario: Pre-aborted signal yields only the reason

- **WHEN** the caller passes an already-aborted signal
- **THEN** the last delta is `{ type: 'done', finishReason: 'aborted' }`

### Requirement: The speech synthesis port SHALL report character ranges and a stoppable handle

`speak()` SHALL return a handle that is stoppable and whose event stream ends
with either `finished` or `stopped`, never both. A `boundary` event SHALL carry
a character range (`location` plus `length`) and SHALL NOT be described as an
audio timestamp.

Stopping a handle SHALL be safe to call once the stream has already finished.

#### Scenario: Ordered speech events

- **WHEN** a caller speaks a short text and drains the handle
- **THEN** the events are `started`, then at least one `boundary`, then `finished`

#### Scenario: Stop ends the stream with stopped

- **WHEN** a caller stops a handle before it finishes
- **THEN** the stream ends with `stopped`
- **AND** no `finished` event follows it

### Requirement: The echo control port SHALL report requested and effective values separately

`requestProfile()` SHALL return both the value that was requested and the value
the capture layer read back, in separate fields. The port SHALL NOT report the
requested value as effective, and SHALL be able to attach a warning when the two
differ.

#### Scenario: Requested and effective agree

- **WHEN** the conversation profile is requested and the capture layer reads back the same value
- **THEN** the report contains a non-empty `requested` and an `effective` equal to it

#### Scenario: Read-back differs from the request

- **WHEN** the capture layer grants something other than what was requested
- **THEN** the report's `effective` differs from `requested`
- **AND** the report carries a warning string

### Requirement: The ports SHALL NOT be wired into the running application

The module SHALL be types plus contracts only: no import from `src/main` or
`src/renderer`, no UI surface, and no modification of the existing
`AsrProvider` contract. Any future implementation SHALL arrive in its own
change with its own gates.

#### Scenario: Dictation path is untouched

- **WHEN** this change is applied
- **THEN** `src/core/asr/types.ts` and the dictation session behaviour are unchanged
- **AND** no renderer file is modified in this change
