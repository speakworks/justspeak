# degradation-gates Specification

## Purpose

Make §f.3 of `docs/SPEAKPILOT-CONVERSATION-PLAN.md` executable: six hard
degradations become pass / fail / unknown plus the action they imply, so a
decision to enter L2 follows from measurements rather than from memory of a
document. The module decides what the data permits; it never announces that the
product passed.

## Requirements

### Requirement: Each §f.3 rule SHALL return a status and the action it implies

The evaluator SHALL expose six rules with the thresholds written in §f.3: endpoint
plus ASR-final P50 above 1.0 s, TTS first packet above 500 ms with 400 ms after
short-sentence segmentation, barge-in mis-trigger above 10%, re-say rate above
25%, context loss inside 10 rounds, and per-route echo mis-trigger above 20%.
Every rule SHALL carry `pass` / `fail` / `unknown`, an action, a readable
evidence string and a Chinese label for the action.

#### Scenario: Endpoint plus ASR over budget

- **WHEN** endpoint P50 is 700 ms and ASR-final P50 is 400 ms
- **THEN** F1 is `fail`
- **AND** its action is L1-only with the "实时对话" wording forbidden

#### Scenario: Barge-in exactly at the limit

- **WHEN** 2 mis-triggers out of 20 trials are observed
- **THEN** F3 is `pass`, because the rule reads "above 10%"

### Requirement: Missing data SHALL read as unknown, never as a pass

A rule without the samples it needs SHALL be `unknown`. `allowL2` SHALL be
`false` when any rule fails, `null` when a blocking rule (F1, F2, F3) is unknown,
and `true` only when every blocking rule was measured and passed. The
"实时对话" wording SHALL be permitted only when `allowL2` is `true`.

#### Scenario: Nothing measured

- **WHEN** all segments are blocked and no human metric is supplied
- **THEN** `allowL2` is `null`
- **AND** the rendered verdict says 未判定 and forbids the wording

#### Scenario: One rule fails

- **WHEN** F3 fails while the others pass
- **THEN** `allowL2` is `false` and the failing rule id is reported

### Requirement: The TTS rule SHALL require the short-sentence value

F2 SHALL NOT fail on the first-packet number alone. When the first packet is
above 500 ms and the short-sentence measurement is absent, F2 SHALL be `unknown`
with the engine swap as the pending action; it SHALL fail only when both exceed
their thresholds.

#### Scenario: High first packet, segmentation not run

- **WHEN** TTS first packet P50 is 700 ms and no short-sentence result exists
- **THEN** F2 is `unknown`
- **AND** the evidence states that the swap cannot be confirmed yet

#### Scenario: Segmentation fixed it

- **WHEN** the first packet is 700 ms and the short-sentence P50 is 380 ms
- **THEN** F2 is `pass` and the evidence says segmentation is what fixed it

### Requirement: The echo rule SHALL be evaluated per route

F6 SHALL evaluate each route's echo sample independently and force L1 on the
routes above 20% while leaving the others unchanged. A route with no sample
SHALL make the rule `unknown` unless another route already fails.

#### Scenario: One echo-heavy route

- **WHEN** `bluetooth` mis-triggers 4 of 10 and `built-in` 1 of 10
- **THEN** F6 fails and names `bluetooth` as forced to L1
- **AND** `built-in` is not listed as forced

### Requirement: The verdict SHALL render as a table in the collected report

The verdict SHALL render with the L2 decision, the wording decision and one row
per rule carrying condition, status, action and evidence, plus a note that
"未测" is not "未触发".

#### Scenario: Report rendering

- **WHEN** the collected report is written
- **THEN** it contains a §f.3 section listing F1 through F6
- **AND** the status column distinguishes 触发 / 未触发 / 未测
