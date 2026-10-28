## Context

The capture path already produces bounded 16 kHz mono PCM16: `PcmBatcher` emits 20 ms batches, `PcmBuffer` rejects anything past 120 s, and `SessionController` calls one injected `AsrProvider` on the finalized utterance. The Qwen3 adapter writes one temporary WAV and spawns the pinned CLI once. `AsrCapabilities.streaming` is `false` for both the fake and Qwen3 adapters, and nothing in the current contract can produce partial text during recording.

The card's constraints are narrower than a full pipeline rewrite: only new `src/core/audio/**` code, `src/main/**`, `src/shared/**`, tests, and this OpenSpec change may change; the provider contract, paste policy, 120 s bound, and default path must stay as they are. That excludes edits to `src/core/session/session-controller.ts`, so the opt-in variant must fit behind the existing `AsrProvider` seam.

## Goals / Non-Goals

**Goals:**

- Deliver silence-aware segmentation for long dictation without adding a dependency.
- Make detection and segmentation pure and directly unit-testable with synthetic PCM.
- Preserve the default single-shot path exactly: one provider call, same audio, same result handling.
- Contain per-segment failures without losing successful segments or dropping audio silently.
- Keep the 120 s session bound, provider error taxonomy, and ADR-0003 retry policy intact.

**Non-Goals:**

- Token streaming, live partial transcripts, or a streaming transport.
- Replacing RMS gating with a model-based VAD (Silero) or introducing a runtime model.
- Changing the default provider selection or enabling segmentation for real users by default.
- UI controls for thresholds; the knobs are environment variables for the benchmark phase.
- Cross-segment context repair (for example fixing a word split exactly at a boundary).

## Decisions

### 1. Segmenting, not streaming

This change produces **final text per segment after recording stops**. It does not stream. The distinction matters to future readers: `QWEN3_CAPABILITIES.streaming` is `false`, the pinned CLI accepts one WAV and exits, and the `AsrProvider` contract returns one `ProviderResult<TranscriptionResult>` per call. A segmented path that calls the provider N times sequentially is still final-only; it reduces per-call audio length and skips silence, but it cannot emit a partial transcript while the user is speaking.

Any future partial-transcript feature requires a different provider contract (incremental results and cancellation) and a streaming-capable runtime. It must not be inferred from the presence of `src/core/audio/vad.ts`.

### 2. RMS hysteresis in core, with constants that need measurement

`vad.ts` frames the PCM (default 320 samples, matching the 20 ms capture batch) and computes normalized RMS. A region opens at `startThreshold` and closes only after `minSilenceMs` of frames below the lower `endThreshold`. The lower exit threshold is the hysteresis: a word tail or a short intra-sentence dip that falls between the thresholds does not end the region and start a new provider call.

Starting constants: start 0.02 (about -34 dBFS), end 0.008 (about -42 dBFS, a 2.5x band), minimum speech 250 ms, minimum silence 400 ms, padding 200 ms. They are chosen to ignore room tone while keeping quiet built-in microphones usable, and the minimum silence matches AUDIO-PIPELINE's 400 ms trailing-silence target. They are explicitly provisional: RMS cannot distinguish speech from music or keyboard noise, and these values must be tuned on the human's real recordings before the segmented path could become a default. Padding is clamped to half of each neighbouring gap so padded regions can never overlap.

Alternatives: a model-based VAD was deferred by the intake decision because it adds a runtime dependency and the card only needs to prove the shape; a fixed-frame energy gate without hysteresis was rejected because it chatters at word tails.

### 3. Segmentation preserves speech and refuses to truncate

`segmentPcm` trims silence outside and between detected regions but never drops samples inside a region. Regions below `MIN_SEGMENT_MS` are merged with a neighbour (keeping the gap) rather than discarded; a lone short region is widened symmetrically with surrounding silence, and a clip shorter than the minimum yields the whole clip. All-silence audio yields zero segments, which the adapter reports as an empty transcript plus a `NO_SPEECH` warning without calling the provider.

The segmenter repeats the 120 s bound with `SEGMENTED_MAX_SESSION_SAMPLES` instead of trusting the caller. `PcmBuffer` already enforces it upstream; this is defence in depth so opting into segmentation cannot bypass the session limit. Input above the bound is a typed `AUDIO_TOO_LONG` error, never a truncated transcript.

### 4. Opt-in adapter behind the existing provider seam

`SegmentedAsrProvider` wraps an `AsrProvider`, implements the same contract, and is only constructed by `createTranscriptionProvider(provider, 'vad', ...)`. For `'single'` that factory returns the inner provider **by identity**, so the default path cannot be altered by the wrapper.

The main process selects the mode from `JUSTSPEAK_SEGMENTED`: unset, empty, `single`, and `off` keep the existing path; `vad`, `on`, and `segmented` enable the wrapper; any other value fails closed with a visible startup error. This mirrors the `JUSTSPEAK_ASR` selector and avoids silently running a different pipeline than the operator asked for.

Wiring the adapter instead of editing `SessionController` is a deliberate consequence of the card's file scope. The adapter is the narrowest existing seam: it can segment, call sequentially, concatenate, and contain failures while the session state machine, retry policy, and paste behavior stay untouched.

### 5. Ordering is sequential, not concurrent

Segments are awaited in index order. Concurrency would reduce wall time but could reorder text, change which segment observes a shared cancellation signal first, and multiply peak memory while the CLI holds a model. The ordering test uses a provider that records call order and returns distinct text per call, then asserts the concatenated text matches that order.

`joinTranscripts` inserts a space only between ASCII word characters; CJK segments concatenate directly. This avoids turning "你好。世界。" into "你好。 世界。" while still separating English words.

### 6. Failure containment within the frozen provider contract

The provider result union cannot carry both successful text and an error. The adapter's behavior is therefore:

- All segments succeed: one success result with the concatenated text.
- Some succeed, some fail: one **success** result with the concatenated successful text, plus a `SEGMENT_FAILED` warning naming the failed indices. The typed `SegmentedTranscriptionError` (zero-based `failedIndices`, per-segment sample ranges, underlying `ProviderError`) is passed to the injected `onPartialFailure` callback, and main attaches its message to the next idle state so the user sees which segment was lost.
- None succeed: one typed error result whose message names every failed index; the session's existing error path displays it.
- No speech: one success result with empty text and a `NO_SPEECH` warning; no provider call.

Failed audio is never presented as transcribed and never silently discarded: the failed index and sample range are always reported. Each segment gets the existing one-retry policy for `TIMEOUT` and retryable `INFERENCE_FAILED`; the policy is duplicated in the audio module with a comment because the session controller is outside this change's scope. The session's overall `timeoutMs` is applied per segment, so the total wall time of a segmented call can exceed it by the segment count; this is recorded as a trade-off, not hidden.

### 7. Configuration is fail-closed and only validated when opt-in

`parseSegmentationConfig` reads numeric overrides for thresholds, durations, frame size, and minimum segment length. Values are validated through `resolveVadConfig` (end below start, positive windows, non-negative durations). Invalid values abort startup rather than falling back to the single-shot path, because a user who set `vad` must not be told segmentation ran when it did not. When the mode is `single`, the knobs are not read, so an unrelated invalid environment variable cannot disturb the default path.

## Risks / Trade-offs

- **RMS thresholds are unmeasured.** Music, fans, and keyboard transients can look like speech, and a quiet microphone can fall below the start threshold. Mitigation: environment knobs, synthetic tests, and an explicit opt-in gate; real-speech tuning is required before any default change.
- **False cuts at boundaries.** A split inside a phrase can lose context or split a word. Mitigation: 400 ms minimum silence, 200 ms padding, and merging very short regions; the residual boundary error stays a quality risk.
- **Per-segment CLI overhead.** More calls mean more process spawns and WAV writes, so a long dictation may be slower than one large call. Mitigation: silence segments are skipped and the path stays opt-in until benchmarked.
- **Partial failures are a success result.** The session state machine cannot represent "text plus error", so the user sees the partial text pasted and a message on the next idle state rather than the error state. A future session-contract change could carry the typed failure natively.
- **Per-segment timeout.** The session's timeout is enforced per segment rather than across the whole request. A pathological provider can therefore take longer in total than one single-shot call.
- **120 s bound is duplicated.** The constant lives in both `src/main/pcm-buffer.ts` and the audio module. A test pins the segmented value, but the two are not structurally linked because the main module is not importable from core.
