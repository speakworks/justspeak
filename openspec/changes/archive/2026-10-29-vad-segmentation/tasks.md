## 1. Pure detector and segmenter

- [x] 1.1 Add `src/core/audio/vad.ts` with normalized-RMS analysis windows, separate start/end thresholds, minimum speech and silence durations, bounded padding, and config validation.
- [x] 1.2 Add `src/core/audio/segmenter.ts` with ordered speech segments, silence trimming, short-region merge/widen, a typed `AUDIO_TOO_LONG` bound at 120 s, and a minimum segment length.
- [x] 1.3 Add synthetic-signal tests for hysteresis, silence/speech patterns, all silence, no silence, one-word utterances, silence at both ends, short regions, and the session bound.

## 2. Opt-in segmented transcription

- [x] 2.1 Add `SegmentedAsrProvider` and `createTranscriptionProvider` in `src/core/audio/segmented-provider.ts`, returning the inner provider by identity in single-shot mode.
- [x] 2.2 Run segments sequentially, retry a segment once under the ADR-0003 policy, concatenate successful text in utterance order, and expose a typed `SEGMENT_FAILED` error with failed indices and sample ranges.
- [x] 2.3 Add ordering and failure-containment tests with a recording fake provider, plus a test proving the default mode makes exactly one provider call.

## 3. Main-process wiring

- [x] 3.1 Add `src/main/asr/segmentation-mode.ts` to parse `JUSTSPEAK_SEGMENTED` and the VAD/segment environment overrides, failing closed on invalid values.
- [x] 3.2 Wrap the selected provider only in `vad` mode in `src/main/index.ts`, leave the default path untouched, and attach a partial-failure message to the next idle state.
- [x] 3.3 Add parser tests for default, opt-in, unknown-value, non-numeric, and invalid-threshold configurations.

## 4. Documentation and verification

- [x] 4.1 Document the streaming-versus-segmenting distinction, the provisional RMS constants, the opt-in gate, and the failure-containment trade-off in `design.md`.
- [x] 4.2 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `openspec validate --specs --strict` after archiving the change.
