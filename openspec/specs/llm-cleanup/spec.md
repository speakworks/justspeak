# llm-cleanup Specification

## Purpose

Provide an optional, off-by-default correction stage for dictated
self-corrections. Rules own the candidate and the guard; a local or BYOK
endpoint model only chooses one closed action, and any failure returns the
rule-cleaned text. The local backend ships a bundled llama.cpp runtime and
downloads Qwen2.5-1.5B-Instruct on demand; the endpoint backend sends text only
when the user explicitly selects it.

## Requirements

### Requirement: LLM cleanup SHALL be opt-in and off by default

The application SHALL expose a `llmBackend` setting with `off`, `local`, and
`endpoint` values, defaulting to `off`. When `off`, the application SHALL NOT
start the local sidecar, contact an endpoint, or alter the rule-cleaned text.

#### Scenario: First run

- **WHEN** the app starts with no stored LLM preference
- **THEN** `llmBackend` is `off`
- **AND** no sidecar process is spawned
- **AND** no LLM network request is made

#### Scenario: Backend disabled

- **WHEN** the user selects `off`
- **THEN** the next transcript is delivered exactly as the deterministic
  post-processing stage produced it

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

### Requirement: Endpoint cleanup SHALL be explicit and key-safe

The endpoint backend SHALL use an OpenAI-compatible chat-completions URL and
model. The API key SHALL be stored through Electron safeStorage and SHALL NOT be
returned to the renderer; settings SHALL expose only whether a key exists. The
transcript SHALL be sent only when the endpoint backend is selected.

#### Scenario: Endpoint configured

- **WHEN** the user selects the endpoint backend and supplies a base URL, model,
  and optional key
- **THEN** the app calls `<base>/v1/chat/completions` (or `<base>/chat/completions`
  when the base already ends in `/v1`) with an 800 ms timeout
- **AND** the key is sent only as a Bearer header

#### Scenario: No silent cloud fallback

- **WHEN** the local backend is selected but unavailable
- **THEN** the app does not call the configured endpoint

### Requirement: The model SHALL choose a closed action, not rewrite text

The correction stage SHALL find at most one correction-marker candidate and
SHALL ask the model for one action from
`keep_all`, `delete_marker_only`, `delete_before_keep_after`,
`delete_after_keep_before`, `merge_ellipsis_keep`, or `defer_to_human`.
An empty or invalid action SHALL be treated as `defer_to_human`.

#### Scenario: Single candidate

- **WHEN** the text contains one marker set off by punctuation and followed by
  content
- **THEN** the model chooses one action from the closed set
- **AND** no other text is rewritten

#### Scenario: No candidate

- **WHEN** the text contains no marker, multiple markers, or a marker inside a
  word
- **THEN** the correction stage returns the rule text unchanged

#### Scenario: Ellipsis boundary

- **WHEN** the candidate's separator run before the marker contains an ellipsis
- **THEN** clause deletion is clamped to marker-only deletion
- **AND** the reported/ellipsis text is preserved

### Requirement: A deterministic guard SHALL reject unsafe corrections

The stage SHALL reject an empty result, a length ratio outside `[0.3, 1.2]`,
or any change to the digit sequence. A rejected correction SHALL return the
rule text unchanged.

#### Scenario: Number changed

- **WHEN** the model action would change `3点` to `4点`
- **THEN** the guard rejects the result and the rule text is delivered

#### Scenario: Timeout or malformed output

- **WHEN** the model times out, returns invalid JSON, or returns an unknown action
- **THEN** the rule text is delivered unchanged

### Requirement: The settings surface SHALL make backend state honest

The settings panel SHALL show the selected backend, local runtime/model status,
download progress, endpoint fields, and whether an API key is stored. It SHALL
state that endpoint mode sends the transcript to the configured service and that
the local backend keeps it on device.

#### Scenario: Local backend status

- **WHEN** the local backend is selected
- **THEN** the panel shows whether the runtime and model are ready
- **AND** offers a download action when the model is missing

#### Scenario: Local sidecar crashes

- **WHEN** the llama.cpp sidecar exits unexpectedly
- **THEN** the panel reports that the local model cannot run instead of claiming it is ready
- **AND** the next utterance uses the rule text while a replacement sidecar starts

#### Scenario: Endpoint privacy notice

- **WHEN** the endpoint backend is selected
- **THEN** the panel states that transcript text is sent to the configured service
- **AND** local endpoints are described as not leaving the device
