## 1. Correction contract (pure, test-first)

- [x] 1.1 Tests for single-marker candidates, marker-in-word, multiple markers, ellipsis boundary
- [x] 1.2 Closed action apply: clause deletion, marker-only, keep, defer
- [x] 1.3 Guard: empty result, length ratio, digit-sequence preservation
- [x] 1.4 `correctWithLlm` returns the rule text on decision failure/timeout

## 2. Local backend

- [x] 2.1 `scripts/package-llm-runtime.ts` stages llama.cpp with `@loader_path`, ad-hoc signatures, licenses, manifest
- [x] 2.2 `resources/llm-models.json` pins Qwen2.5-1.5B-Instruct Q4_K_M URL/size/SHA-256
- [x] 2.3 `LlmManager` downloads through `ModelManager`, verifies, and reports status
- [x] 2.4 `LlmCorrector` warms the sidecar lazily and falls back on failure
- [x] 2.5 Electron builder ships `resources/llm` and the LLM catalog; packaging scripts stage both runtimes

## 3. Endpoint backend

- [x] 3.1 OpenAI-compatible request with 800 ms timeout, Bearer key, closed action parsing
- [x] 3.2 Key stored encrypted with safeStorage; renderer sees only `hasKey`
- [x] 3.3 Endpoint errors and invalid responses fall back to rule text

## 4. Settings and session integration

- [x] 4.1 Extend preferences (backend, base URL, model) with validation
- [x] 4.2 Settings row: backend picker, local status/download, endpoint fields, key save/clear, privacy text
- [x] 4.3 Session controller optional async refine stage before delivery
- [x] 4.4 Preferences view reports runtime/model/key status and messages

## 5. Verification

- [x] 5.1 `pnpm typecheck`, `pnpm test`, `pnpm build`, `openspec validate --specs --strict`
- [x] 5.2 E2E: settings row switches backends, shows local download, saves endpoint
- [x] 5.3 Real local chain: `LlmCorrector` with staged llama-server returns `周二发。`
- [x] 5.4 Packaged app starts with the LLM catalog/runtime in Resources
- [x] 5.5 `pnpm llm:eval` refuses an empty dataset and points at the SOP

## 6. Not included (explicitly deferred)

- [ ] 6.1 Real 20–30 recording evaluation and the default-on decision (requires owner recordings)
- [ ] 6.2 Apple Foundation Models adapter
- [ ] 6.3 Unix-socket/token hardening for the localhost sidecar
