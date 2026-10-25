# Privacy

> This is a pre-release placeholder. It must be completed before the first
> public release.

## Data JustSpeak processes

- Microphone audio.
- Transcripts and user corrections.
- Settings and optional telemetry.

## Questions to answer before release

- Is audio processed locally, in the cloud, or both? Which providers?
- Is audio retained? For how long? Where?
- Are transcripts stored locally? Can the user delete them?
- What telemetry is collected? Is it opt-in?
- Which OS permissions are requested (microphone, accessibility, input
  monitoring)?
- How does v0.2 desktop control prevent unintended actions?

## Principles

- Do not log raw audio or transcripts by default.
- Make local-only operation a first-class option where feasible.
- Disclose every network destination and retention period.
