## Why

The local cleanup sidecar listens on a random `127.0.0.1` port without
authentication. Any local process can find the port and submit chat
completions, and the original `llm-cleanup` design deferred a Unix socket or
token. A per-start token is the smaller, testable step: llama.cpp 0.8.0
supports `--api-key-file`, and the key file can be deleted after the model has
loaded it.

## What Changes

- Each sidecar start generates a 32-byte random API key.
- The key is written to a `0600` file inside a private `0700` temp directory
  and passed with `--api-key-file` (not argv, so `ps` does not show it).
- After `/health` succeeds, the key file and directory are removed; the server
  keeps the key in memory.
- `decide()` sends `Authorization: Bearer <key>`.
- Requests without the key get 401; `/health` remains unauthenticated.
- The key never enters the spawn log; failed starts and stops clean the file.

## Impact

- Affected specs: `llm-sidecar-auth` (new).
- Affected code: `src/main/llm/sidecar.ts`, its tests.
- No settings, no UI, no change to the correction contract.
