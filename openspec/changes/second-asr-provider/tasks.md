## 1. Gate

- [x] 1.1 Download the pinned SenseVoice Small Q8_0 GGUF without a VPN, record its source URL, size, and SHA-256, and run it through the pinned transcribe.cpp CLI on Chinese and English samples; record the exact commands and output in `design.md`.
- [x] 1.2 Confirm the runtime advertises the model, license, backend, and 30 s window; if it cannot run a second family, stop with a ticket instead of writing an adapter.

## 2. Core adapter

- [x] 2.1 Extract the shared ADR-0003 behavior into `InferenceProvider` and make `Qwen3AsrProvider` a thin subclass with unchanged exports and behavior.
- [x] 2.2 Add `SenseVoiceAsrProvider` with truthful capabilities (`streaming: false`, `timestamps: false`, `vad: false`, `maxAudioMs: 30_000`, languages `zh/yue/en/ja/ko`, `Q8_0`).
- [x] 2.3 Add `describeCapabilities` so the UI can render capabilities without a provider-id lookup.

## 3. Catalog and licensing

- [x] 3.1 Add the pinned SenseVoice entry to `resources/models.json` with revision `ff8f085a…`, SHA-256 `6c759ee4…59adf29`, size 252,684,608 bytes, license `FunASR-Model-License-1.1`, and the first-run download URL.
- [x] 3.2 Verify the catalog test pins the digest/size/license/languages and that the weights are not labeled MIT; keep weights out of git.

## 4. Selection and UI

- [x] 4.1 Accept `sensevoice` in mode parsing; resolve precedence env → persisted preference → `qwen3`; fail visibly on unknown ids; reject `fake` as a persisted preference.
- [x] 4.2 Add a preference store (`asr-preference.json`) that returns stored ids unvalidated and never throws on a corrupt file.
- [x] 4.3 Build every provider in one place (`buildProvider`) and wire startup, first-run download, verification, and the `asr:set-provider` IPC path.
- [x] 4.4 Add the provider picker and a capability summary to the renderer; keep the default provider and existing fake/Qwen3 behavior intact.

## 5. Tests and verification

- [x] 5.1 Run the unchanged `tests/provider-contract.ts` suite over the SenseVoice adapter; add capability honesty, 30 s boundary, and language-hint tests.
- [x] 5.2 Add mode/precedence, preference round-trip/corrupt-file, unknown-id failure, and fake/qwen3/sensevoice construction tests.
- [x] 5.3 Add an opt-in real CLI smoke for SenseVoice (fixture transcription) and record the digital-silence hallucination limitation.
- [x] 5.4 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `openspec validate --specs --strict`; record the results.
- [x] 5.5 Commit on `feat/second-provider`, push, and open a PR against `main` without merging.
