## Why

A two-minute dictation currently reaches the ASR provider as one WAV and one CLI call. That makes the result depend on a single large inference, and it gives the pipeline no way to skip silence or contain a partly bad utterance. AUDIO-PIPELINE.md proposed VAD endpointing and silence splitting for long utterances, but the pinned Qwen3 CLI is a one-shot process and `QWEN3_CAPABILITIES.streaming` is `false`. Segmentation is therefore the realisable path; token streaming is not.

This change adds a pure detector and segmenter plus an opt-in provider wrapper. It does not switch the default: the existing single-shot path must remain byte-for-byte the default until real-speech measurements justify changing it.

## What Changes

- Add a pure `src/core/audio/vad.ts` detector over 16 kHz mono PCM16. It uses short-window normalized RMS with separate start and end thresholds (hysteresis), a minimum speech duration, a minimum silence duration, and bounded padding. No runtime dependency is added.
- Add a pure `src/core/audio/segmenter.ts` that converts detected regions into ordered segments, trims leading and trailing silence, merges regions below the minimum segment length instead of dropping them, and rejects input above the 120 s session bound.
- Add `SegmentedAsrProvider` in `src/core/audio/segmented-provider.ts`: an `AsrProvider` adapter that runs segments sequentially, retries a segment once under the existing ADR-0003 policy, concatenates successful text in utterance order, and keeps successful segments when one fails. Failures carry a typed `SEGMENT_FAILED` error naming the zero-based failed index and its sample range.
- Wire the adapter as an opt-in selection in the main composition root. `JUSTSPEAK_SEGMENTED` is unset/single by default; `vad` enables segmentation. VAD thresholds and durations have environment overrides so real-speech tuning does not require a rebuild.
- Surface a partial failure next to the delivered text: the frozen provider contract cannot return text and an error together, so the adapter returns the successful text as success plus a typed warning, and main attaches that message to the next idle state.
- Add Vitest coverage for hysteresis, every segmenter edge case named by the card, ordering with a recording fake provider, failure containment, the 120 s bound, configuration parsing, and proof that the default mode still makes exactly one provider call.

## Capabilities

### New Capabilities

- `audio-segmentation`: pure RMS-hysteresis speech detection, segment construction and bounds, opt-in sequential segmented transcription, final-only behavior, and failure containment.

### Modified Capabilities

- `dictation-session`: adds the opt-in segmented dictation variant and its failure-visibility behavior while leaving the default single-shot session contract in place.

## Impact

- `src/core/audio/` (new): `vad.ts`, `segmenter.ts`, `segmented-provider.ts`. Pure TypeScript; no Electron, DOM, filesystem, or timer use.
- `src/main/index.ts`: resolves the opt-in mode at startup and wraps the selected provider only in `vad` mode; the default provider object is returned unchanged.
- `src/main/asr/segmentation-mode.ts` (new): fail-closed parsing of `JUSTSPEAK_SEGMENTED` and `JUSTSPEAK_VAD_*` / `JUSTSPEAK_SEGMENT_MIN_MS` knobs.
- `tests/`: `vad.test.ts`, `segmenter.test.ts`, `segmented-provider.test.ts`, `segmentation-config.test.ts`, plus a synthetic-signal helper.
- No provider contract, paste policy, 120 s session bound, or default transcription path changes.
