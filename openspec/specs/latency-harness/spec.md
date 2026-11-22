# latency-harness Specification

## Purpose

Make the Phase 0 gate of `docs/SPEAKPILOT-CONVERSATION-PLAN.md` executable: measure the
three segments that can be measured on this machine today, write them into a fixed
shape, and record every unmeasurable case as `blocked` rather than as a zero or an
estimate. The harness measures; it never declares that the product passed.

## Requirements

### Requirement: The harness SHALL offer three independently runnable segments

The harness SHALL provide one entry point that runs the ASR, LLM and TTS segments
independently or together, selected by argument. Running one segment SHALL NOT
require the prerequisites of the others, and a segment not selected SHALL be
recorded as `skipped` with that reason.

#### Scenario: Only the TTS segment requested

- **WHEN** the operator runs the harness with the TTS segment only
- **THEN** the ASR and LLM segments are recorded as `skipped` with the reason that they were not requested
- **AND** no ASR or LLM prerequisite is opened or checked to the point of failing the run

#### Scenario: All three segments requested

- **WHEN** the operator runs all three segments
- **THEN** each segment produces its own status, sample set and summary
- **AND** a blocked segment does not abort the remaining ones

### Requirement: An unmeasured segment SHALL be recorded as blocked, never as zero or an estimate

A segment that cannot run SHALL carry `status: blocked` plus a reason naming the
missing prerequisite or the failed step. Samples SHALL be empty, the summary SHALL
be null, and the rendered report SHALL show `—` rather than `0`. No code path
SHALL substitute a reference figure from documentation for a measurement.

#### Scenario: ASR runtime missing

- **WHEN** the ASR CLI or model file is absent
- **THEN** the ASR segment is `blocked` and its reason names the missing path
- **AND** the report's ASR row shows `blocked` and `—`, never `0`

#### Scenario: LLM served without SSE

- **WHEN** the sidecar answers the streaming request with `application/json` instead of an event stream
- **THEN** the LLM segment is `blocked` with the reason `stream 未验证`
- **AND** the non-streaming completion time is recorded as context, labelled as such

### Requirement: The TTS probe SHALL reject samples that cannot represent audible speech

The TTS segment SHALL read back the loaded voice count. Zero voices SHALL
invalidate the sample set. A median first-packet time below 20 ms SHALL likewise
invalidate it, because both cases indicate callbacks fired without audio.

#### Scenario: No voice loaded

- **WHEN** `speechSynthesis.getVoices()` returns an empty list while `onstart` still fires
- **THEN** the segment is `blocked` with a reason stating that the callbacks do not represent audible output
- **AND** the discarded samples are not summarised as a latency result

#### Scenario: Implausibly fast first packet

- **WHEN** the median first-packet time is below 20 ms
- **THEN** the segment is `blocked` mentioning the rejected median
- **AND** the rejected value is kept in the detail rather than promoted to the headline

### Requirement: The harness SHALL write a content-free JSON record and a readable Markdown report

Each run SHALL write JSON containing timings, sample counts, thresholds and device
metadata, and SHALL NOT contain recognised speech text or audio. Each run SHALL
write a Markdown report carrying the commit, the route, the per-segment result,
the comparison against §f.1 and the mechanical reading of the §f.3 rules.

#### Scenario: Report fields for a blocked run

- **WHEN** all three segments are blocked
- **THEN** the Markdown states the measured count as `0 / 3`
- **AND** each gate reads `未测` rather than a boolean

#### Scenario: JSON keeps no transcript

- **WHEN** the ASR segment succeeds on the fixture
- **THEN** the JSON records the elapsed milliseconds and fixture identity
- **AND** the recognised text stays on the console only and never enters the JSON file

### Requirement: The Phase 0 grid SHALL be blank and complete

The harness SHALL be able to emit a grid with one row per recording × route for
20 recordings and three routes, every cell marked as unfilled. The grid SHALL NOT
contain placeholder numbers.

#### Scenario: Template emitted

- **WHEN** the operator requests the template only
- **THEN** the file contains 60 rows covering `rec-01` to `rec-20` across `built-in`, `wired` and `bluetooth`
- **AND** every measurement cell reads as unfilled

### Requirement: The harness SHALL NOT change product behaviour

The harness SHALL live in `scripts/` and `bench/` and SHALL NOT be imported by
`src/main`, `src/renderer` or `src/preload`. It SHALL NOT alter the dictation
session, the ASR providers, the injection chain, the version number or any
workflow file.

#### Scenario: Product code untouched

- **WHEN** the change is reviewed
- **THEN** the only files outside `scripts/`, `bench/`, `docs/`, `tests/` and `openspec/` are the two added `package.json` script entries
- **AND** the version number is unchanged
