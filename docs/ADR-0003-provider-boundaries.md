# ADR-0003: Replaceable Provider Boundaries for ASR, Capture, Injection, and Hotkeys

- Status: Accepted (design baseline for v0.1)
- Date: 2026-10-26
- Deciders: project owner (human), implementation agent (facilitator)
- Related: ADR-0001, ADR-0002, ASR-RESEARCH, AUDIO-PIPELINE, TEXT-INJECTION-HOTKEYS, WINDOWS-PORT, TESTING-STRATEGY

## Context

JustSpeak v0.1 has selected a local-first default and several fallback paths:

- ASR: Qwen3-ASR 0.6B as the quality default, SenseVoice Small as the lightweight tier, and
  Whisper small/medium as the multilingual fallback. The final model is still gated on a
  local benchmark.
- Runtime: transcribe.cpp is the selected ggml/GGUF runtime; sherpa-onnx and whisper.cpp
  remain alternatives.
- Capture: renderer Web Audio/AudioWorklet is the v0.1 default; a Swift `AVAudioEngine`
  helper is the fallback. Windows later uses a WASAPI helper with renderer fallback.
- Injection: clipboard + paste is the v0.1 default; direct Accessibility insertion is a
  later upgrade; CGEvent typing is a per-app fallback.
- Hotkeys: Electron `globalShortcut` is the v0.1 default; Fn/Right Option and
  hold-to-talk require a native event tap.

These choices will change. Models improve, licenses change, Windows arrives, and the v0.2
agent may need a different execution boundary. If UI, settings, benchmark code, and IPC all
name Qwen3/SenseVoice/transcribe.cpp directly, every change becomes a cross-cutting edit.

The project already has a core boundary (ADR-0001) and a native-helper boundary
(ADR-0002). This ADR adds the missing provider boundaries inside those boundaries.

## Decision

Define four explicit interfaces and keep model/platform-specific code in adapters.

### 1. `AsrProvider`

```ts
interface AsrProvider {
  readonly id: string;
  readonly capabilities: AsrCapabilities;
  prepare(model: AsrModelDescriptor): Promise<void>;
  transcribe(input: AudioInput, options: TranscribeOptions): Promise<TranscriptionResult>;
  dispose(): Promise<void>;
  health(): Promise<ProviderHealth>;
}

interface AsrCapabilities {
  languages: string[];
  streaming: boolean;
  punctuation: boolean;
  itn: boolean;
  timestamps: boolean;
  vad: boolean;
  maxAudioMs: number;
  quantizations: string[];
}

interface TranscriptionResult {
  text: string;
  language?: string;
  segments?: TranscriptSegment[];
  confidence?: number;
  latencyMs: number;
  modelId: string;
  runtimeId: string;
  warnings: ProviderWarning[];
}
```

- `AudioInput` is always 16 kHz mono PCM16. Resampling and channel mixing happen in the
  capture adapter, not in the ASR provider.
- `TranscribeOptions` carries only cross-provider concepts: language hint, punctuation/ITN
  preference, optional vocabulary, timeout, and cancellation. Provider-specific knobs live
  in a typed `providerOptions` bag and must not leak into the UI.
- Capability flags are authoritative. The UI and pipeline ask `capabilities.streaming`,
  not `id === "qwen3"`.
- Errors use a shared taxonomy: `MODEL_MISSING`, `MODEL_LOAD_FAILED`,
  `UNSUPPORTED_LANGUAGE`, `AUDIO_TOO_LONG`, `INFERENCE_FAILED`, `TIMEOUT`, `CANCELLED`.
- Adapters: `Qwen3AsrProvider`, `SenseVoiceAsrProvider`, `WhisperAsrProvider`,
  `ParakeetAsrProvider` (later), `CloudAsrProvider` (opt-in BYOK, later).

### 2. `CaptureSource`

```ts
interface CaptureSource {
  readonly id: string;
  readonly capabilities: CaptureCapabilities;
  start(options: CaptureOptions): Promise<void>;
  stop(): Promise<CaptureSummary>;
  onFrame(listener: (frame: PcmFrame) => void): Unsubscribe;
  onError(listener: (error: CaptureError) => void): Unsubscribe;
}

interface PcmFrame {
  samples: Int16Array;
  sampleRate: 16000;
  channels: 1;
  capturedAtMs: number;
  sequence: number;
}
```

- Capture owns device selection, permission prompts, route changes, echo
  cancellation/noise suppression/AGC policy, resampling, and framing.
- Capture never knows which ASR model is running.
- Adapters: `RendererAudioWorkletCapture`, `SwiftAVAudioEngineCapture`,
  `WindowsWasapiCapture` (later). The renderer adapter uses a hidden recorder window,
  AudioWorklet, a worker/ring buffer, and a named pipe or batched transferable channel when
  per-frame IPC proves costly.
- `CaptureCapabilities` includes `deviceSelection`, `routeChange`, `echoCancellation`,
  `noiseSuppression`, `autoGainControl`, `maxBufferMs`, and `requiresAccessibility`.

### 3. `InjectionStrategy`

```ts
interface InjectionStrategy {
  readonly id: string;
  readonly capabilities: InjectionCapabilities;
  canInsert(target: FocusTarget): Promise<boolean>;
  insert(text: string, target: FocusTarget): Promise<InjectionResult>;
}

interface InjectionCapabilities {
  clipboard: boolean;
  accessibility: boolean;
  directTyping: boolean;
  secureInputSafe: boolean;
  preservesClipboard: boolean;
}
```

- `ClipboardPasteStrategy` is the v0.1 default. It owns full clipboard snapshot/restore,
  transient markers, ownership checks, modifier-release waiting, and terminal paste chords.
- `AXInsertStrategy` is a later opt-in. It must prefer `setSelectedText`; whole-field
  `setValue` is allowed only for an empty field or an explicit user choice, and the
  destination is revalidated before every write.
- `CGEventTypingStrategy` is a per-app fallback, never the default.
- Fallbacks are explicit and reported in `InjectionResult` (`method`, `fallbackUsed`,
  `warnings`). No silent fallback to a different app or field.
- `FocusTarget` is a captured, validated reference (process, bundle id, window, focused
  element, selection range). It is revalidated before insertion; a changed target falls
  back to clipboard or a visible copy prompt.

### 4. `HotkeySource`

```ts
interface HotkeySource {
  readonly id: string;
  readonly capabilities: HotkeyCapabilities;
  start(bindings: HotkeyBinding[]): Promise<void>;
  stop(): Promise<void>;
  onPress(listener: (binding: HotkeyBinding) => void): Unsubscribe;
  onRelease(listener: (binding: HotkeyBinding) => void): Unsubscribe;
}

interface HotkeyCapabilities {
  supportsFn: boolean;
  supportsRightModifier: boolean;
  canSuppress: boolean;
  requiresAccessibility: boolean;
  requiresInputMonitoring: boolean;
}
```

- `ElectronGlobalShortcut` is the v0.1 default for toggle-style bindings.
- `NativeEventTap` is the later adapter for Fn, Right Option, hold-to-talk, and
  suppression. It must recover when macOS disables the tap.
- The hotkey layer never embeds ASR or injection behavior; it emits press/release events.

### Composition and ownership

- `src/core` owns the interfaces, normalized types, capability negotiation, and fallback
  policy. It does not own OS APIs.
- The Electron main process is the composition root. It reads configuration, creates
  adapters, and wires them. The renderer receives only view models and commands.
- ASR, capture, injection, and hotkey work that needs OS privileges runs in the Swift
  helper, a dedicated worker, or the Windows helper. The renderer is UI only.
- The IPC contract uses the normalized types above. No `qwen3`, `sensevoice`,
  `transcribe.cpp`, `AX`, or `WASAPI` names appear in renderer code.
- A provider registry maps `id` to a factory and a model descriptor. Model descriptors are
  data (`models.json`), not code: id, version, files, SHA-256, size, license, source URL,
  quantization, runtime compatibility, and capabilities.

### Configuration and defaults

```json
{
  "asr": {
    "primary": "qwen3-asr-0.6b-q8",
    "lite": "sensevoice-small-q8",
    "fallback": "whisper-small"
  },
  "capture": { "mode": "renderer-audio-worklet" },
  "injection": { "mode": "clipboard-paste" },
  "hotkey": { "mode": "electron-global-shortcut" }
}
```

- Defaults are the accepted v0.1 choices. Every default can be replaced by config without
  touching the UI.
- Cloud ASR/LLM is never a silent fallback. It requires explicit opt-in and a visible
  destination.
- The final model/quantization is selected by the benchmark, not hard-coded in the
  provider.

### Model distribution

- The base installer contains no model weights. First run downloads the selected model,
  shows size/license/source, verifies SHA-256, and supports resume and deletion.
- `models.json` is signed or checksummed as part of the release; the app rejects entries
  that do not match.
- Each model entry records its license and attribution requirements. A model without a
  cleared license cannot become a default.

### Testing

- Every adapter passes a shared contract test suite: capability honesty, error taxonomy,
  cancellation, timeout, max audio, empty/silence input, and result shape.
- Unit tests use `FakeAsrProvider`, `FakeCaptureSource`, `FakeInjectionStrategy`, and
  `FakeHotkeySource`. No test needs a real model or microphone.
- The ASR benchmark harness consumes the same `AsrProvider` interface and records model,
  runtime, quantization, hardware, CER/WER, latency, RTF, memory, and cold start.
- Integration tests run each real adapter behind the same contract; platform tests cover
  microphone permission, secure input, terminal paste, Fn/Right Option, and TCC identity.

## Consequences

### Positive

- A model swap (Qwen3 → SenseVoice → Whisper → Parakeet) is an adapter + registry change,
  not a UI/core rewrite.
- A capture swap (renderer → Swift/Windows helper) keeps ASR and injection unchanged.
- An injection/hotkey upgrade (clipboard → AX, globalShortcut → event tap) is isolated and
  testable.
- Capability flags make fallbacks explicit and prevent "this model doesn't support
  streaming" from leaking into UI conditionals.
- The benchmark compares models through one interface and one result schema.

### Negative

- Interfaces add upfront design and adapter boilerplate.
- Some provider-specific features (vocabulary prompts, timestamps, language IDs) may not
  map cleanly; the `providerOptions` bag and `warnings` are escape hatches, not a license
  to leak types.
- Capability flags can be wrong; contract tests must verify them.
- IPC serialization and process boundaries add latency if the hot path is chatty.

### Mitigations

- Keep the interfaces small; add methods only when a second adapter needs them.
- Contract tests for every adapter; fake providers for unit tests.
- Report every fallback in the result and log; never silently switch cloud/local or
  app/field.
- Measure IPC and capture latency in the audio spike; move hot paths native if needed.

## Alternatives considered

1. **Direct model calls in UI/core.** Rejected: every model/runtime change becomes a
   cross-cutting edit; benchmark and fallback logic duplicate.
2. **One "ASR service" without capability flags.** Rejected: callers still need to know
   whether streaming/punctuation/timestamps exist; hidden behavior becomes bugs.
3. **Tauri/Rust rewrite to get provider boundaries.** Rejected for v0.1: the boundaries are
   language-neutral; Electron + native helper meets the latency gates, and a shell rewrite
   adds risk without solving the model-swap problem. Revisit if the performance spike
   fails or if v0.2's agent hot path needs a separate native service.
4. **Plugin marketplace in v0.1.** Rejected: too much surface for one release; the registry
   is internal and signed.

## Open questions

1. Exact IPC transport between renderer/helper and the ASR worker (named pipe,
   MessagePort, Unix socket, shared memory).
2. Whether ASR runs in the Swift helper, a separate worker process, or the main process;
   memory ownership and crash isolation.
3. How vocabulary/prompt biasing is expressed across providers without leaking
   provider-specific prompt strings.
4. The v0.2 streaming interface (`onPartial`) and whether it shares `AsrProvider` or a
   separate `StreamingAsrProvider`.
5. Model registry signing/hosting and offline-pack verification.
6. Windows helper contract parity (WASAPI, UIA, clipboard, global hotkeys).
7. Whether capture and ASR should share a process to avoid an extra copy of PCM.

## Decision status

Accepted as the v0.1 design baseline. Implementation starts after the scaffold and the
audio/ASR benchmark spikes. The interfaces may change once real adapters expose missing
capabilities, but the boundary itself (four replaceable providers) is fixed.

## Sources

- ADR-0001: `docs/ADR-0001-core-boundary.md`
- ADR-0002: `docs/ADR-0002-tech-stack.md`
- ASR research: `docs/ASR-RESEARCH.md`
- Audio pipeline: `docs/AUDIO-PIPELINE.md`
- Text injection and hotkeys: `docs/TEXT-INJECTION-HOTKEYS.md`
- Windows port: `docs/WINDOWS-PORT.md`
- Testing strategy: `docs/TESTING-STRATEGY.md`
- Licensing: `docs/LICENSING.md`
- transcribe.cpp model docs: https://github.com/handy-computer/transcribe.cpp/tree/main/docs/models
- Qwen3-ASR model card: https://huggingface.co/Qwen/Qwen3-ASR-0.6B
