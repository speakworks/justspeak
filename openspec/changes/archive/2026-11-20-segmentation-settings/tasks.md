## 1. Core logic

- [x] 1.1 Add the pure segmentation-preference module: three values, labels, descriptions, and an auto-repairing reader.
- [x] 1.2 Add `segmentation` to the stored preference shape, the writable keys, and the atomic merge rules.
- [x] 1.3 Persist and read the key through `ThemeStore.loadPreferences` with an `auto` fallback.
- [x] 1.4 Add env resolution: a valid value overrides, an invalid one falls back with the exact notice, and unset keeps the preference.
- [x] 1.5 Keep invalid VAD knobs failing closed while a bad env mode no longer fails the session.

## 2. Segment metadata

- [x] 2.1 Add the optional `TranscriptSegmentMeta` to `TranscriptionResult` and the shared event/panel payloads.
- [x] 2.2 Fill metadata from successful `SegmentTranscript` sample ranges when two or more segments succeed.
- [x] 2.3 Forward runner-provided metadata through `InferenceProvider` instead of dropping it.
- [x] 2.4 Copy metadata into `TranscriptEvent` in the session controller.
- [x] 2.5 Retain the in-flight metadata in main and pass it to the copy panel payload.

## 3. Provider and preference application

- [x] 3.1 Resolve the effective mode at provider build from the stored preference and the env override.
- [x] 3.2 Rebuild the provider through the existing initialization path after an idle save; defer while busy and report the restart requirement.

## 4. Settings surface

- [x] 4.1 Add the 长句听写 radio group with one explanation per option, using existing classes and Chinese copy.
- [x] 4.2 Show the effective mode, the exact env takeover sentence, the exact invalid-value fallback sentence, and the deferred-save sentence.
- [x] 4.3 Disable the group and select the effective mode while a valid env value is in charge.

## 5. Copy panel

- [x] 5.1 Add the pure `m:ss` duration and `N 段 · …` line formatter.
- [x] 5.2 Render the segment line only when the payload carries metadata.

## 6. Tests

- [x] 6.1 Cover mode resolution: each preference, unset env, valid env override, aliases, invalid env fallback with the exact notice, and a non-failing session.
- [x] 6.2 Cover persistence and merge: default `auto`, round trip, merge with other keys, corrupt fallback, invalid write rejection.
- [x] 6.3 Cover metadata: two-segment order/times, zero-duration boundary, one-segment and no-speech omission, and partial failure successes only.
- [x] 6.4 Cover the event and panel: segment forwarding, `0:00` / `1:05` formatting, multi-segment separator, and no line without metadata.
- [x] 6.5 Cover the settings row labels for default, override, env takeover, fallback, and deferred save.

## 7. Verification and delivery

- [x] 7.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `openspec validate --specs --strict`.
- [x] 7.2 Archive the change, re-run the gates, and ship one branch, one commit, and one pull request.
