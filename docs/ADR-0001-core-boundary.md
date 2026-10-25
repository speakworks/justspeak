# ADR-0001: Core boundary and repository strategy

- Status: Accepted
- Date: 2026-10-25
- Decision owner: FD2008

## Context

JustSpeak (v0.1) is a desktop dictation product. SpeakPilot (v0.2) is a desktop
voice agent. They share transcription and audio core capabilities. The project
is maintained by a single developer and released as open source under MIT.

## Decision

1. v0.1 starts as a **single package/repository** (`speakworks/justspeak`) with
   an internal `core` boundary. Do not create a separate `packages/core` package
   or an empty `apps/speakpilot` directory before there is a second consumer.
2. The **core** owns: audio pipeline (capture → VAD → ASR stream →
   post-processing), model management, and the transcription settings schema.
3. The **app/shell** owns: UI, platform integration (Electron/Tauri/Swift/etc.),
   permissions, global hotkeys, text injection, auto-update, telemetry, and
   OS-specific behavior.
4. **Dependency rule:** app → core. The core must not import UI, platform, or
   OS-specific APIs. Core logic must be testable with fake audio/ASR adapters.
5. v0.2 may extract `speakworks/speakpilot` as a second repository only when at
   least one split criterion is met: independent release cadence, external
   contributors needing separate access, a security boundary, or repository
   size/maintenance burden. Otherwise, keep both products in one repository.
6. When split, publish the core as a versioned package (`@speakworks/core` or
   the language-specific equivalent) and consume it from both apps. Do not copy
   code.

## Consequences

- v0.1 avoids premature abstraction and cross-repo release overhead.
- The core boundary is enforced by directory structure, lint/import rules when
  the stack is chosen, and tests using fakes.
- A future split is a refactor, not a rewrite, because the core contract is
  explicit.

## Open questions

- The technology stack is not finalized. The core boundary is stack-agnostic;
  concrete package layout will be recorded in a follow-up ADR.
- v0.2 permissions and desktop-control security require a separate design
  review.
