## 1. Key lifecycle

- [x] 1.1 Generate a random key per start; write `0600` file in a private temp dir
- [x] 1.2 Pass `--api-key-file`, never the key in argv; delete the file after health
- [x] 1.3 Clean the key on failed start, stop, and restart
- [x] 1.4 Send `Authorization: Bearer` from `decide()`

## 2. Verification

- [x] 2.1 Fake server rejects missing/wrong key and accepts the generated key
- [x] 2.2 Disk assertions: 0600 file / 0700 dir, removed after start, failure, stop, restart
- [x] 2.3 Key never appears in logs; startup fails closed if the runtime ignores auth
- [x] 2.4 Real `pnpm llm:probe` succeeds with the pinned llama.cpp runtime
- [x] 2.5 `pnpm typecheck`, `pnpm test`, `pnpm build`, E2E, OpenSpec validation

## 3. Not included

- [ ] 3.1 Unix-socket transport
- [ ] 3.2 Same-user packet capture protection
