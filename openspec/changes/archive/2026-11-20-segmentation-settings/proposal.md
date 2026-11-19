## Why

Long dictation is already segmented when an utterance exceeds the provider's
limit, but the only way to choose the mode is the experimental
`JUSTSPEAK_SEGMENTED` environment variable. A packaged user cannot set it, an
invalid value currently makes the whole ASR session unusable, and the user has
no way to see which mode actually ran. Segmented runs also discard the
per-utterance ranges, so the copy panel cannot tell a three-utterance dictation
from one long one.

This change turns the mode into a first-class preference, keeps the env var as
an explicit override that degrades instead of failing, and carries successful
segment metadata through the transcript event to the copy panel.

## What Changes

- **Preference.** `userData/preferences.json` gains `segmentation` with three
  values: `auto` (default), `vad`, and `single`. It is written through the
  existing `ThemeStore.update` / `mergePreferences` path; an invalid write is
  rejected atomically, and a missing or corrupt stored value reads as `auto`.
- **Resolution.** A valid `JUSTSPEAK_SEGMENTED` (including the historical
  aliases `on`, `segmented`, `off`) overrides the preference. An invalid value
  falls back to the preference and produces the readable notice
  `JUSTSPEAK_SEGMENTED 的值无效（<value>），已回退到设置中的「<档位名>」。`
  instead of failing the session. An unset or empty variable uses the
  preference.
- **Apply time.** Saving the preference rebuilds the provider through the
  existing switch path when no recording is in flight and the env var is not in
  charge. A busy pipeline defers the change, and the panel then states
  `已保存，下次启动生效` with the mode that is still running.
- **Segment metadata.** `TranscriptionResult` and `TranscriptEvent` gain an
  optional `segments: TranscriptSegmentMeta[]` where an element is
  `{ index, startMs, durationMs }`. The segmented provider fills it from its
  successful `SegmentTranscript` ranges at 16 kHz when two or more segments
  succeed. One-shot, single-segment, and no-speech paths leave it absent; a
  partial failure includes only the successes and keeps the `SEGMENT_FAILED`
  warning. `InferenceProvider` forwards any runner-provided metadata instead of
  discarding it.
- **Copy panel.** `ResultPanelPayload` gains the same optional field. When it is
  present the panel shows one line such as `3 段 · 0:12 / 0:18 / 0:09`; when it
  is absent the panel renders nothing extra.
- **Settings UI.** The settings panel gains a 长句听写 radio group with one
  explanation per option. It shows the effective mode, the exact env takeover
  text when a valid variable is in charge, the exact fallback text when the
  variable is invalid, and the deferred-save text when applicable.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `audio-segmentation`: mode preference, env precedence with graceful fallback,
  and successful-segment metadata on results.
- `settings-surface`: the 长句听写 row and its honest effective/environment
  reporting.
- `dictation-session`: transcript events carry segment metadata and the copy
  panel renders the summary line.

## Impact

- `src/shared/ipc`: `SegmentationView`, the `segmentation` preference key,
  `TranscriptEvent.segments`, and `ResultPanelPayload.segments`.
- `src/core/preferences`: a pure segmentation-preference module plus merge and
  view rules.
- `src/main`: preference loading, env resolution with fallback, provider rebuild
  on save, panel payload wiring.
- `src/core`: `TranscriptSegmentMeta`, segmented-provider metadata, inference
  passthrough, session event forwarding, and a pure panel formatter.
- `src/renderer`: the settings radio group and the panel segment line.
- `tests`: resolution, persistence, metadata, event propagation, and formatting.

## Goals

- A user can choose long-dictation behavior without environment variables, and
  every surface names the mode that is actually running.
- An invalid `JUSTSPEAK_SEGMENTED` value is a visible, non-blocking fallback
  rather than an unusable ASR session.
- Segmented dictation discloses which successful utterances produced the text
  without changing one-shot results or inventing metadata.

## Non-Goals

- Exposing the seven `JUSTSPEAK_VAD_*` knobs in the UI.
- Changing the VAD algorithm or its env parsing beyond the mode precedence.
- Extending `HistoryEntry` or history storage with segment metadata; this
  change does not persist segments.
- Rewriting the session lifecycle to hot-swap a provider mid-recording.

## Risks

- **Env precedence confusion.** A valid variable makes the saved preference
  inert. The panel therefore disables the radio group, selects the effective
  mode, and prints the exact takeover sentence, so it cannot claim a different
  mode than the one running.
- **Deferred rebuild.** Applying through the existing provider path avoids a
  second lifecycle, but the rebuild is skipped while recording. The view marks
  that case `未生效` and names the mode still in use; nothing is silently
  promised.
- **Panel noise.** A single-segment run deliberately carries no metadata, so
  short dictation and one-shot results show no extra line.
