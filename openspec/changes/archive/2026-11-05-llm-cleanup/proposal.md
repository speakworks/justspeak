## Why

The rule-based self-correction was removed in #23 because it guessed wrong about
reported speech, ellipses, and negation. Research (#24) and a sidecar spike
(#25) showed a safer path: keep deterministic rules, let a model choose one
closed action inside a rule-marked candidate, verify the result, and fall back
to the rule text on any failure.

Users asked for both a local and a cloud option. The default must stay offline:
no model is loaded, no endpoint is called, and no text leaves the device unless
the user explicitly enables one backend.

## What Changes

- Add an opt-in **智能清理** setting with three backends: `off` (default),
  `local` (bundled llama.cpp sidecar + downloaded Qwen2.5-1.5B-Instruct), and
  `endpoint` (OpenAI-compatible BYOK URL/model/key).
- The local runtime ships in `Contents/Resources/llm`; the model is downloaded on
  demand into `userData/models/llm` with SHA-256 verification. The download is
  explicit, not a side effect of dictation.
- Endpoint API keys are stored with Electron safeStorage and never returned to
  the renderer; only `hasKey` is exposed.
- The correction stage runs after deterministic post-processing and before
  delivery. Rules find a single correction-marker candidate; the model returns
  one closed action; a deterministic guard rejects number changes, empty
  results, and extreme length changes; any failure returns the rule text.
- The optional stage never blocks delivery: an 800 ms timeout and `undefined`
  fallback are part of the contract.
- No change to the default dictation path, history schema, or paste behavior
  when the backend is off.

## Capabilities

### New Capabilities

- `llm-cleanup`: the opt-in local/endpoint correction stage and its settings.

### Modified Capabilities

None.

## Impact

- `src/core/llm/{decision,correction,model-catalog}.ts`,
  `src/main/llm/{sidecar,corrector,manager,key-store}.ts`,
  `src/core/session/session-controller.ts`, `src/main/index.ts`,
  `src/preload/index.ts`, `src/shared/ipc.ts`,
  `src/renderer/src/{App,SettingsPanel}.tsx`.
- `resources/llm-models.json`, `resources/llm` (gitignored runtime),
  `electron-builder.yml`, packaging scripts, notices/licenses.
- `docs/LLM-EVAL-SOP.md` and `scripts/llm-eval.ts` for the Go/No-Go evaluation.
- No new runtime dependency in `package.json`: the sidecar is a staged native
  binary, and the model is a downloaded file.
