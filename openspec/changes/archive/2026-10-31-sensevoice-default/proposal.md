## Why

The owner used both providers on real dictation and found SenseVoice Small more
accurate, and it is 252 MB against Qwen3's 850 MB. It cannot, however, accept
more than 30 seconds of audio (`SENSEVOICE_MAX_AUDIO_MS`), and the segmentation
that would cover that limit is opt-in and off by default. Making SenseVoice the
default without changing anything else would fail every recording longer than
half a minute.

## What Changes

- `DEFAULT_ASR_MODE` becomes `sensevoice`.
- Segmentation gains an `auto` mode and becomes the default: an utterance inside
  the selected provider's own limit uses the unchanged one-shot path, and only a
  longer one is segmented. `single` and `vad` remain available to force either
  behaviour through `JUSTSPEAK_SEGMENTED`.
- An explicit provider value is honoured as written — `JUSTSPEAK_ASR=qwen3`
  keeps Qwen3 even though it is no longer the default.

## Capabilities

### Modified Capabilities

- `asr-provider`: the default provider changes, and the default segmentation
  mode that keeps its 30-second ceiling usable is stated with it.
- `audio-segmentation`: segmented transcription is no longer opt-in-only.
- `dictation-session`: the session segments only what does not fit the provider.
