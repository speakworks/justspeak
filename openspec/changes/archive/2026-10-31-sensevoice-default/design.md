## Decision

Turn segmentation into a per-utterance decision instead of a global switch:

```
mode 'single'  -> provider (unchanged, historical behaviour)
mode 'vad'     -> always segment
mode 'auto'    -> provider when pcm fits capabilities.maxAudioMs, else segmented
```

`AutoAsrProvider` compares the captured sample count against the selected
provider's own `maxAudioMs`, so the rule follows the provider rather than a
constant. SenseVoice (30 s) therefore segments long speech while Qwen3 (87 min)
almost never does, and short dictation keeps exactly the results it had before
segmentation existed.

## Why not simply default `vad`

Forcing VAD on every utterance would run leading/trailing-silence trimming on
one-second dictation too, changing results for input that never needed it. The
`auto` form gets the coverage the 30-second ceiling requires without touching the
common path.

## Risks

| Risk | Mitigation |
|---|---|
| `auto` hides a segmentation failure behind a path the user did not choose | Partial failures still surface through the existing `onPartialFailure` notice and the typed `SEGMENT_FAILED` error |
| SenseVoice's 30 s ceiling becomes the default ceiling for long speech | The segmented adapter advertises the 120 s session bound and splits any region longer than the provider's own limit into consecutive chunks, so each provider call stays inside 30 s. Beyond 120 s the typed error names the limit |
| Existing users silently switch engines | The persisted provider preference wins over the default, so anyone who already chose Qwen3 keeps it |
