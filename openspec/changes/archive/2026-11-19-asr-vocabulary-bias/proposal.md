## Why

The only vocabulary mechanism today is the post-processing stage: `replace`
rewrites text after the model has already decoded it. That repairs a known
mapping (库贝内特斯 → Kubernetes) but cannot fix a term the model never
produces, because by the time post-processing runs the acoustic decision is
already made. Product names, acronyms, and personal names are exactly the case
where the model picks a similar-sounding word and the literal replacement table
has nothing to match.

The pinned runtime already exposes a decode-time channel. transcribe.cpp 0.4.1
accepts `--vocabulary TERMS`: comma-separated, repeatable, and ordered, where
earlier terms carry higher priority
(`models/runtime/transcribe.cpp/examples/cli/main.cpp:212-248`, semantics in
`include/transcribe.h:1207-1213`). Qwen3-ASR declares the vocabulary feature
(`src/arch/qwen3_asr/capabilities.cpp:26`) and prepends the terms to the system
message alongside the prompt (`src/arch/qwen3_asr/model.cpp:417-421`).
SenseVoice does not declare it (`src/arch/sensevoice/capabilities.cpp` sets only
cancellation and ITN), and the runtime warns and clears the field when an
unsupported model receives terms (`src/transcribe-asr.cpp:264-272`). The runtime
drops terms from the tail when the prompt budget is exceeded
(`src/transcribe-prompting.cpp:97`).

In this repository the hook exists but is dead: `TranscribeOptions.vocabulary`
is declared at `src/core/asr/types.ts:71` and no code consumes it; the runner
spawns `['-q', '-m', modelPath, wavPath]` at `src/main/asr/cli-runner.ts:213`;
`AsrCapabilities` has no vocabulary bit; and `resources/models.json` declares
none. `parseVocabularyConfig` silently drops unknown keys
(`src/core/postprocess/vocabulary.ts:170-195`), so a new file field is backward
compatible by construction, and `serializeVocabularyConfig` currently writes
only `replace` and `protect`.

## What Changes

- **Vocabulary file.** `userData/vocabulary.json` gains a top-level
  `terms: string[]`, parallel to `replace` and `protect`. Trimmed, exact-deduped,
  file order preserved, capped at 32. A file without `terms` loads with `[]` and
  never errors.
- **Capability bit.** `AsrCapabilities` gains `vocabularyBias: boolean`. Qwen3 is
  true; SenseVoice and the deterministic fake are false; catalog validation
  requires the field; `resources/models.json` declares it per model.
- **Runner.** When the active provider declares the bit and the term list is
  non-empty, one ordered `--vocabulary` argument is appended to the existing CLI
  invocation. Empty terms send no flag.
- **Degradation.** No capability bit → no flag, transcript untouched, and a
  `ProviderWarning` with code `VOCABULARY_UNSUPPORTED` on the result. A CLI that
  rejects the flag is retried once without it and reports the same warning. A
  runtime budget cut keeps the transcript and, when the runtime reports it,
  adds a truncation warning. Settings readback states the limitation truthfully.
- **No semantic rewriting.** Terms are decode-time hints only. They never enter
  the post-processing rule pass as replacements, protections, or masks; there is
  no pinyin, homophone, or edit-distance fallback in this change.
- **Visibility.** The settings row reads 术语 N 条 / 替换 N 条 / 保护 N 条, adds the
  count of entries dropped for containing an ASCII comma, and the diagnostics
  summary records counts only, never term content.

## Impact

- **User data.** `userData/vocabulary.json` gains an optional top-level field;
  no migration and no file version bump. Old files keep working.
- **Core.** `AsrCapabilities`, catalog validation, the three provider
  declarations, and the post-processing parser/serializer.
- **Main.** CLI argument construction, the vocabulary store summary, settings
  readback, and the diagnostics summary.
- **Renderer and shared.** Read-only term counts on the existing preferences
  surface; no new editor.
- **Runtime.** No vendored runtime change; the pinned binary already supports
  the flag.
- **Docs Impact (fulfilled).** User-facing vocabulary documentation is
  delivered as `docs/VOCABULARY.md`: it covers the new `terms` field and its
  limits, the provider support matrix, and the measured 0.6B hint/echo risk.

## Goals

- A spoken term the model would otherwise normalise away can be biased at decode
  time on providers that support it, with user order as priority.
- Every unsupported path is a visible, non-destructive degradation: text is
  never altered to force a term, and a transcription never fails only because
  the vocabulary channel is unavailable.
- Existing vocabulary files keep working unchanged, and saving the file never
  erases `terms`.

## Non-Goals

- Pinyin, homophone, fuzzy, or edit-distance matching against decoded text.
  Silent substitution can corrupt ordinary prose when a term collides with a
  common word, and the runtime already offers a decode-time channel; a
  text-level rescue is a separate design decision.
- Editing terms in the renderer UI. This change adds the file field, the
  read-back counts, and the ASR path only.
- Per-term weights, per-provider term subsets, or hot-reload during a
  transcription.
- Any change to the `replace` / `protect` semantics or to the post-processing
  rule order.

## Risks

- **Small-model echo.** The runtime documentation warns that
  `docs/models/qwen3-asr-0.6b.md:21` echoes the dictionary into the output more
  often than the 1.7B model. Terms are hints, not instructions; the 32-entry cap
  and the visible read-back bound the blast radius, and no post-processing
  rewrite follows a term.

  Measured on this machine (2026-11-19, Qwen3-ASR 0.6B Q8_0, Metal, 22 runs,
  the pinned `transcribe-cli`, deterministic across repeats):
  - The flag is real: on `samples/product-names.wav`, one term `P3 Quadro`
    rewrote every spoken `P three/O three/B three …` name into digit form
    (`O3`, `B3`, `E3`, `W3`, `O2`, `U3`, `M3`) — far beyond the supplied term.
  - Echo is reproducible: the term `O3 Omni` replaced the real opening
    `Quark, Quid, Quill Inc.` with `O3 Omni` and repeated it at the end.
  - Biasing can make output worse: `Quark,Quid,Quill Inc.` dropped `Quid`,
    turned `Quadro` into `Quattro` and `Wrap Z` into `Rap Z`, identically on
    every repeat.
  - Unrelated terms stay quiet: 32 fruit names in zh/en, `Kubernetes`, `X7 Y8`
    and `Quadro` changed nothing; `bench/fixtures/zh-4s.wav` with homophone
    terms stayed byte-identical; no measurable slowdown.

  Consequence for the product: terms must stay opt-in (empty by default), the
  read-back must show the count, and user-facing documentation must say a term
  is a hint the model may over-generalise or echo. The app never compensates by
  rewriting the transcript.
- **Priority at the runtime budget.** The runtime truncates from the tail
  (`src/transcribe-prompting.cpp:97`), so tail terms can silently disappear
  inside the runtime even under the app's 32-entry cap. The spec keeps order
  meaningful and requires a warning only when the runtime reports the cut.
  The pinned source does emit `dropped N of M vocabulary terms`
  (`src/transcribe-prompting.cpp:150-161`) and the CLI writes it to stderr; the
  runner recognises that line. It has not been observed from a live
  over-budget run — the live stderr shape remains **unconfirmed**, and the
  transcript path does not depend on it.
- **Comma-bearing terms.** The CLI splits `--vocabulary` on `,`, so a term with
  an ASCII comma cannot be expressed. Dropping it with a visible count is
  preferred over silently passing a mangled list.
- **Unknown-flag retry.** The pinned CLI supports the flag, so the retry path is
  defensive. It must run at most once and must not mask a real inference error.
