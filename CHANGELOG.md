# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial repository scaffold and project documentation.
- Added the technical research and decision documents for the v0.1 plan. Technical research
  and decisions are indexed in [docs/TECH-DECISIONS.md](docs/TECH-DECISIONS.md).
- Added ADR-0003 provider boundaries and refreshed the decision index to reflect the
  accepted v0.1 choices.
- Local ASR through transcribe.cpp: SenseVoice Small Q8_0 is the default provider,
  Qwen3-ASR 0.6B is selectable in settings, and `auto` segmentation keeps recordings
  longer than SenseVoice's 30-second ceiling usable.
- Global hotkey dictation with press-to-record configuration, menu-shortcut suppression
  during capture, and a 15-second safety restore.
- Three delivery paths: insert into the app's own input, paste into the focused app
  through the clipboard, or leave the transcript in the persistent copy panel.
- Local history with WAV playback, copy, and delete, plus a personal vocabulary with
  replace and protect rules.
- Optional LLM cleanup, off by default: a local Qwen2.5-1.5B sidecar or an
  OpenAI-compatible endpoint, rule-owned candidates, closed actions, guardrails, and an
  800 ms fallback.
- Diagnostics export as a local zip with redacted logs; nothing is uploaded.
- Unsigned macOS packaging, a model bootstrap script, an LLM evaluation harness, and a
  Playwright Electron E2E suite.

### Changed

- Closing the main window now hides it and keeps JustSpeak running: the hotkey, the
  recording pill and dictation stay live with no window on screen. Quitting is explicit
  (`Cmd+Q`, the Dock, the application menu, or the menu-bar icon).
- A menu-bar icon carries the actions that outlive the window: show or hide the window,
  start or stop dictation, open settings, and quit.
- The application menu replaces Electron's default template, which exposed 重新加载 and
  开发者工具 in a resident app.
- The packaged app now ships the JustSpeak icon on the Dock, in Finder and on the DMG
  instead of Electron's default icon.
- SenseVoice Small became the default ASR provider; Qwen3-ASR 0.6B remains selectable.
- The settings panel owns theme, hotkey, provider, LLM, and diagnostics; the vocabulary
  editor lives in the 词典 destination; the page header no longer carries a provider
  picker.
- The sidebar footer no longer repeats the running ASR model; the settings provider row
  is the only place it is named and switched.
- The 首页 dictation card is capped at 300 px and top-aligned instead of stretching to
  fill the pane; long transcripts scroll inside the input.

### Fixed

- The provider hint no longer points at a header control that no longer exists.
- The local LLM sidecar is stopped after five minutes without a request, returning its
  ~1.1 GB model memory to the system, and restarted lazily on the next utterance.

### Security

- The LLM sidecar generates a per-launch API key, passes it through a `0600` file in a
  `0700` temporary directory, deletes the file after start, and fails closed when the
  runtime ignores the key.

## [0.1.0] - TBD

- First public pre-release of JustSpeak.
