## Context

The sidecar is a child `llama-server` process on a random localhost port. The
port is reachable by any local process, and the model costs ~1 GB of memory, so
unauthenticated access is both a privacy and a resource-exhaustion surface. The
original change deferred "Unix socket or token" hardening.

## Decisions

### Token, not Unix socket

llama.cpp can listen on a UNIX socket path, but Node's `fetch` has no built-in
Unix-socket transport; switching would require a custom dispatcher or an HTTP
client change. `--api-key-file` is supported by the pinned `llama.cpp 0.8.0-dev`
and closes the practical "any local process can call the port" path with a
small change. A Unix socket remains a future option.

### Key handling

- Generate 32 random bytes per start (`crypto.randomBytes`).
- Write `key.txt` under `mkdtempSync(<tmp>/justspeak-llama-key-)` with mode
  `0600`; the directory is `0700`.
- Pass `--api-key-file <path>`; the key is not in argv.
- Delete the file and directory after `/health` returns 200. The real server
  keeps the key in memory (verified with curl: no-auth 401, correct Bearer 200
  after deleting the file).
- `decide()` sends the Bearer header; `/health` is not authenticated.
- Logs contain the binary, flags, and the **path**, never the key.

### Failure and cleanup

A failed spawn, health timeout, or stop removes the key file/directory. Cleanup
errors are swallowed: a leftover temp key is less important than a working
stop/quit path. A new start always clears any earlier key state.

## Risks

- A local process running as the same user can read the temp key during the
  brief startup window before the file is deleted. The random filename and
  `0600` mode bound that window; the token is not a defense against a fully
  compromised user account.
- Loopback traffic is unencrypted; the token prevents casual/unauthorized use,
  not a same-user packet capture.
- The key stays in main-process memory after the file is deleted. A crash dump
  can therefore contain it; `docs/PRIVACY-SECURITY.md` and the diagnostics
  bundle README disclose in-memory secrets and ask the user to inspect a bundle
  before sharing.
- `/health` remains public so the supervisor can poll it without a key.
- The start-up negative check assumes the pinned runtime honors
  `--api-key-file`; any runtime that ignores it fails closed at start.

## Verification

- Fake server test: no-auth/wrong-auth → 401; `decide()` with the generated key
  → 200; key file is gone after start.
- Real `pnpm llm:probe` against the staged llama.cpp + Qwen2.5 GGUF.
