## MODIFIED Requirements

### Requirement: Local cleanup SHALL use a bundled runtime and a verified model

The local backend SHALL run a bundled llama.cpp sidecar from
`Contents/Resources/llm` and SHALL use the Qwen2.5-1.5B-Instruct Q4_K_M model
from the LLM catalog. The model SHALL be downloaded only after an explicit user
action, into `userData/models/llm`, and SHALL be verified by size and SHA-256
before use. Missing runtime or model SHALL leave the backend unavailable and
SHALL NOT fall back to a cloud endpoint.

The sidecar SHALL be stopped after a bounded idle window with no decision
request, returning its model memory to the system, and SHALL be started again
lazily on the next request. A reclaim SHALL NOT be reported as a failure, SHALL
NOT run while a decision is in flight, and SHALL NOT change the rule-cleaned
text of the utterance that follows it — that utterance uses the rule text while
a replacement sidecar warms, matching the cold-start behavior. A zero window
SHALL disable the reclaim, which the evaluation harness relies on because it
scores continuously.

#### Scenario: Model not downloaded

- **WHEN** the local backend is selected and the model file is absent
- **THEN** settings report that the model is not downloaded
- **AND** corrections are skipped until the user downloads it

#### Scenario: Verified download

- **WHEN** the user downloads the local model
- **THEN** the app downloads to a temporary file, verifies the pinned size and
  SHA-256, atomically renames it into `userData/models/llm`, and reports progress
- **AND** a mismatched file never reaches the final path

#### Scenario: Sidecar failure

- **WHEN** the sidecar crashes, exits, or fails to become healthy
- **THEN** the decision falls back without a transcript loss

#### Scenario: Idle sidecar is reclaimed

- **WHEN** the local backend is selected and no decision has been requested for
  the idle window
- **THEN** the sidecar is stopped and its model memory returns to the system
- **AND** settings report the local backend as idle rather than failed
- **AND** the next request starts a replacement sidecar and uses the rule text
  for that utterance

#### Scenario: A request is in flight

- **WHEN** the idle window elapses while a decision request is still running
- **THEN** the sidecar is not stopped
- **AND** the idle window restarts when the request finishes
