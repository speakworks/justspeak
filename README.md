# JustSpeak

> Just speak. It types.

**JustSpeak** is an open-source desktop speech-to-text tool: speak naturally, and clean text appears at your cursor.

> **Status:** early development. v0.1 focuses on high-quality real-time dictation. A companion desktop voice agent, **SpeakPilot**, is planned for v0.2.

## Why JustSpeak

- Speak instead of typing.
- Clean, punctuation-aware text.
- Local-first where possible; cloud engines optional.
- Built to share a transcription core with SpeakPilot.

## Roadmap

| Version | Product | Focus |
|---|---|---|
| v0.1 | **JustSpeak** | Real-time desktop dictation |
| v0.2 | **SpeakPilot** | Voice-controlled desktop agent, built on the same core |

See [docs/ROADMAP.md](docs/ROADMAP.md).

## Project docs

- [Website](https://speakworks.github.io/justspeak/)
- [Core boundary ADR](docs/ADR-0001-core-boundary.md)
- [Privacy](docs/PRIVACY.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## Development (M1: local ASR)

M1 runs a real local transcript path: the renderer sends 16 kHz mono PCM to main,
main writes a temporary WAV, and the pinned `transcribe.cpp` CLI transcribes it with
one of two catalog-backed providers, Qwen3-ASR 0.6B Q8_0 (default) or SenseVoice
Small Q8_0. The fake provider remains available for tests and the demo.

Requirements: macOS arm64, Node 24, pnpm, and Xcode Command Line Tools plus CMake for
the pinned runtime build.

```bash
pnpm install
pnpm setup:asr   # build transcribe.cpp v0.4.1 + download/verify the 850 MB Qwen3 model
pnpm dev         # HMR; or `pnpm start` for the built app
pnpm test        # Vitest contract/IPC/capture/injection/lifecycle suite (no model)
pnpm bench:asr   # provider-driven benchmark; writes bench/reports/<date>-qwen3-asr.md
```

- Hotkey: `Command+Shift+Space` (toggle recording; press again to stop).
- Grant Microphone and Accessibility permissions on first run.
- Default provider is **SenseVoice Small** (`JUSTSPEAK_ASR=sensevoice`); `JUSTSPEAK_ASR=qwen3`
  selects Qwen3. An explicit value is always honoured — it is never remapped to the default.
  Use `JUSTSPEAK_ASR=fake pnpm dev` for the deterministic fake flow. An unknown value is an
  error, and a missing model is never silently replaced by fake or cloud.
- Segmentation defaults to `auto`: an utterance inside the selected provider's own limit
  takes the unchanged one-shot path, and only a longer one is segmented. That is what makes
  SenseVoice's 30-second ceiling usable. `JUSTSPEAK_SEGMENTED=single` forces one-shot and
  `=vad` forces segmentation.
- The in-app provider picker persists to `asr-preference.json` in the app's user-data
  directory; `JUSTSPEAK_ASR` overrides the stored preference for that run.
- Model weights and the built runtime live in gitignored `models/`; nothing is committed.
  The UI shows the model name, its license (Apache-2.0 for Qwen3, FunASR-Model-License-1.1
  for SenseVoice), and the source URL.
- Override paths with `JUSTSPEAK_TRANSCRIBE_CLI`, `JUSTSPEAK_QWEN3_MODEL`, and
  `JUSTSPEAK_SENSEVOICE_MODEL`.
- Verification: `pnpm typecheck`, `pnpm test`, `pnpm build`, and
  `openspec validate --specs --strict`. The M1 change `qwen3-asr-integration` is already
  archived, so validate the synced specs instead of the (closed) change.

## Technical plan

The v0.1 technical plan is documented under `docs/`. Start with the
[technical decisions index](docs/TECH-DECISIONS.md), which records the status and open
questions for each decision.

- [Technology stack ADR](docs/ADR-0002-tech-stack.md)
- [Provider boundaries ADR](docs/ADR-0003-provider-boundaries.md)
- [Architecture](docs/ARCHITECTURE.md)
- [ASR research](docs/ASR-RESEARCH.md)
- [Audio pipeline](docs/AUDIO-PIPELINE.md)
- [Text injection and hotkeys](docs/TEXT-INJECTION-HOTKEYS.md)
- [LLM post-processing](docs/LLM-POSTPROCESSING.md)
- [Privacy and security](docs/PRIVACY-SECURITY.md)
- [Packaging and release](docs/PACKAGING-RELEASE.md)
- [Windows port](docs/WINDOWS-PORT.md)
- [Testing strategy](docs/TESTING-STRATEGY.md)
- [v0.2 SpeakPilot plan](docs/V0.2-SPEAKPILOT.md)
- [Licensing and compliance](docs/LICENSING.md)

## Disclaimer

JustSpeak is an independent open-source project. It is **not affiliated with** JustSpeak AI Tutor, justspeaktoit, justspeak.io, or SpeakWorks, Inc. Any similarity in name is coincidental; these projects and companies are separate.

## License

MIT — see [LICENSE](LICENSE).
