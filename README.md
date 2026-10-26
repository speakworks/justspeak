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

## Development (M0 demo)

The first walking skeleton is macOS-only and uses a fake ASR provider so the UI,
audio capture, hotkey, IPC, and clipboard paste can be tested before integrating a
real model.

```bash
pnpm install
pnpm dev        # HMR; or `pnpm start` for the built app
```

- Hotkey: `Command+Shift+Space` (toggle recording; press again to stop).
- Grant Microphone and Accessibility permissions on first run.
- The current transcript is fake (`FAKE ASR` badge); Qwen3-ASR integration is next.
- `pnpm typecheck` and `pnpm build` are the current verification commands.

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
