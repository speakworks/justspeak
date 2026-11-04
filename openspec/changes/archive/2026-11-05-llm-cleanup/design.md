## Context

The spike (#25) proved a relocatable llama.cpp sidecar works: 24 MB runtime,
warm start ~1.25 s, P50 ~220 ms / P95 ~495 ms for closed decisions, 0 timeouts
at 800 ms, and `defer_to_human` after SIGKILL. It also proved a 1.5B model
cannot be trusted with free-form rewriting: it changed numbers, translated
English, and dropped ellipses. The product therefore uses the model only as a
classifier inside a rule-owned candidate.

The accepted design baseline deferred local LLM cleanup. This change reopens
that decision as an opt-in feature with evidence gates; it is not a default-on
rewrite feature.

## Decisions

### Opt-in, default off

`llmBackend` defaults to `off`. When off:

- no sidecar is started;
- no endpoint is contacted;
- `refine` returns `undefined` and the rule text is delivered unchanged.

Enabling local or endpoint is an explicit user action. The first-run flow does
not preselect a backend.

### Rules own the candidate and the guard

`findCorrectionCandidate` accepts exactly one marker (`不对`, `我是说`, `改成`,
`no wait`, `I mean`) set off by punctuation and followed by content. It returns
null for multiple markers, marker-shaped words, or a marker at the end. The
model never sees an open "clean this" task; it chooses one of six actions.

`guardCorrection` rejects empty output, length ratio outside `[0.3, 1.2]`, and
any change to the digit sequence. An ellipsis boundary clamps
`delete_before_keep_after` to marker-only deletion, because "他说……不对，走了"
must not lose the reported speech. Failure returns the original text.

### Local delivery: bundled runtime, downloaded model

The llama.cpp runtime is staged by `scripts/package-llm-runtime.ts` and shipped
as `Contents/Resources/llm`; it is about 24 MB. The Qwen2.5-1.5B-Instruct
Q4_K_M GGUF (1,117,320,736 bytes, SHA-256
`6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e`) is
downloaded into `userData/models/llm` only when the user asks. The download uses
the existing `ModelManager` atomic `.part` + digest + rename path.

The sidecar warms lazily; the first dictation does not wait for a cold model
load because the UI shows the local backend as unavailable until the model is
downloaded, and `warmup()` runs after configuration.

The downloaded file is verified by SHA-256 during download and re-checked by
its pinned byte size on every status read and before warmup, so a truncated
file cannot be reported as ready. A same-size corruption is not re-hashed on
every dictation; it surfaces when llama-server fails to start (`state=failed`).
When the sidecar crashes, the corrector drops the dead instance and the next
utterance uses rule text while a replacement warms; every lifecycle change
(starting/ready/failed) is pushed to the settings row instead of leaving a
stale "ready" label.

Reads of `preferences.json` are side-effect free: the corrector is configured
at startup and after a successful write. A hand edit made while the app is
running is displayed by `status()` but applies on restart, which keeps a stale
read from re-applying an old backend after a newer write.

### Endpoint keys never cross IPC

Endpoint keys are encrypted with Electron safeStorage (`isAsyncEncryptionAvailable`,
`encryptStringAsync`, `decryptStringAsync`) and stored in `userData/llm-key.bin`.
`PreferencesView` exposes only `hasKey`. The key is sent as a Bearer header only
when the endpoint backend is selected.

### Timeout and failure

The endpoint and sidecar both use an 800 ms decision timeout. Any HTTP error,
invalid JSON, missing action, guard rejection, crash, or timeout returns the
rule-cleaned text. The session treats `refine` as optional: a rejected promise
is logged and the original text is delivered.

### Packaging and licensing

`electron-builder.yml` ships `resources/llm` and `resources/llm-models.json`.
`pnpm package:mac` stages both the ASR and LLM runtimes first. Notices list
Qwen2.5-1.5B-Instruct (Apache-2.0) and llama.cpp (MIT); `licenses/MIT-llama.cpp.txt`
holds the runtime text. Qwen2.5-3B is excluded: Qwen Research License is
non-commercial and its long-input latency exceeds the budget.

## Risks

- 1.5B quality is marginal. The default stays off and the evaluation SOP gates
  any future default-on decision.
- Local startup and RSS are significant (cold 9.3 s, ~1.07 GB). The UI must
  surface model/runtime status and the user must opt in.
- A localhost llama-server port is reachable by other local processes; the
  prototype disables the Web UI, and a future hardening step should use a Unix
  socket or token.
- Prompt injection remains instruction-only; the closed action set and the
  rule-owned candidate bound the blast radius, but integration must not execute
  model text as commands.
