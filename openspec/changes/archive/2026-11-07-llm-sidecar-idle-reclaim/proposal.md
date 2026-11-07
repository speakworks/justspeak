## Why

The local cleanup backend loads a ~1.1 GB GGUF model into a `llama-server` child
process and never releases it. Once the user selects 本地, the sidecar survives
until they switch backends, the model crashes, or the app quits — there is no
idle reclamation anywhere in `src/main/llm/corrector.ts`.

On an 8 GB MacBook Air that also runs a browser and other apps, a background
process holding a gigabyte for hours is the single largest memory cost this app
can impose. The owner raised exactly this after reviewing the running app on
such a machine.

The sidecar already exists to be disposable: it is a separate process, so
stopping it returns its memory to the system, and `warmup()` already restarts it
lazily. What is missing is the trigger.

## What Changes

- Stop the idle local sidecar after a bounded window (default 5 minutes) with no
  decision request, and start it again lazily on the next utterance.
- Never reclaim while a decision is in flight, and never report the reclaim as a
  failure: the files are still there, so the settings row keeps reporting the
  local model as available.
- Make the window injectable (`localIdleTimeoutMs`), with `0` disabling it for
  the evaluation harness, which runs continuously and must not be reclaimed.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `llm-cleanup`: the local sidecar has an idle lifecycle, and reclaiming is not
  a failure.

## Impact

- `src/main/llm/corrector.ts`: idle timer, in-flight accounting, reclaim path.
- `tests/llm-corrector.test.ts`: reclaim and lazy-restart coverage.
- `openspec/specs/llm-cleanup/spec.md`: the local lifecycle requirement.
