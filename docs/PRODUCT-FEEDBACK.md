# Product feedback backlog

Owner trial notes, newest first. This file is a running list of *observed*
problems and the decisions taken about them — it is not a spec and nothing here
is scheduled until it is picked up. Behaviour contracts, when one of these turns
into work, belong in `openspec/`; implementation notes belong in the ADRs.

Add a dated section per review round. Keep the owner's wording verbatim (the
Chinese quotes) so the intent survives paraphrasing, and record the evidence
that makes each item checkable.

---

## 2026-11-07 — trial run: memory on an 8 GB MacBook Air

### 1. The local LLM sidecar never releases its model

- Owner: 「那个 8G 的 Air 的话，它其实还干其他的事情啊」 — the earlier memory
  estimate assumed the app had the machine to itself.
- **Odd before:** `LlmCorrector` started `llama-server` and never stopped it.
  Only a backend switch, a crash, or quitting released the ~1.1 GB model, so one
  use of 本地 cleanup pinned a gigabyte for the rest of the session. With the
  app otherwise idle at ~508 MB, this was the single largest cost it could
  impose on a shared 8 GB machine.
- **Now:** the sidecar is stopped after five minutes without a decision and
  restarted lazily on the next utterance. Reclaim reports `idle`, not `failed`,
  and never runs while a decision is in flight. The evaluation harness disables
  the window (`localIdleTimeoutMs: 0`) because it scores continuously.
- **Not changed:** the 508 MB idle footprint and the per-utterance ASR child are
  as measured; splitting the app into a client/server pair would move memory
  between processes on the same machine, not remove it.
- **Contract:** `openspec/specs/llm-cleanup/spec.md` (archived change:
  `2026-11-07-llm-sidecar-idle-reclaim`).

---

## 2026-11-07 — trial run: sidebar model chip and home input height

### 1. The sidebar repeats the running model

- Owner: 「左侧 设置 入口上方 还有模型的显示，个人觉得不必要，删除模型的显示」
- **Odd before:** `.sidebar-foot` held a low-contrast `.model-chip` naming the
  running ASR model, next to the 设置 entry. The settings panel already names the
  same model in its provider row — the row that also switches it.
- **Now:** the chip, its live dot, its label, and the `providerLabel` /
  `providerLive` props are gone. The footer names destinations only.
- **Made it in:** PR #33, `openspec/specs/settings-surface/spec.md` and
  `openspec/specs/app-shell/spec.md` synced, guarded by
  `tests/e2e/model-switch.spec.ts`.
- **Trade-off accepted:** model readiness ("模型未就绪") is now only visible in
  设置.

### 2. The 首页 dictation area is too tall

- Owner: 「首页右侧 的 口述内容区域 太大了，需要调整」
- **Odd before:** the sheet was `flex: 1` inside the pane, so it filled every
  pixel below the header — roughly 500 px of empty card at the 720×640 window.
- **Now:** `.sheet-dictation` caps the 首页 card at 300 px and top-aligns it,
  leaving the rest of the pane empty. Long transcripts scroll inside the
  textarea, so the page still gains no scrollbar. `.sheet` itself is unchanged
  because 历史记录 reuses it.
- **Made it in:** PR that closed `cap-home-dictation-height`;
  `openspec/specs/app-shell/spec.md` states the cap, and
  `tests/e2e/shell.spec.ts` asserts the height and the page scroll height.

---

## 2026-11-04 — optional LLM cleanup

### 1. Local and endpoint cleanup are available behind an opt-in switch

- Owner decision: do A + C + D. A = un-defer local LLM as opt-in; C = cloud
  endpoint; D = evaluation set. Default remains offline and off.
- **Now:** settings → 智能清理 has `off` / `local` / `endpoint`.
  - Local: bundled llama.cpp sidecar (24 MB) + Qwen2.5-1.5B-Instruct Q4_K_M
    (~1.1 GB) downloaded on demand into `userData/models/llm`, verified by
    SHA-256.
  - Endpoint: OpenAI-compatible base URL/model/optional key; the key is
    encrypted with safeStorage and never returned to the renderer.
  - Correction is rule-gated: one marker candidate, six closed actions, 800 ms
    timeout, digit/length guard, fallback to the rule text on any failure.
- **Not default-on:** the 1.5B quality is marginal; the Go/No-Go evaluation
  gates any future default change.
- **Contract:** `openspec/specs/llm-cleanup/spec.md` (archived change:
  `openspec/changes/archive/2026-11-05-llm-cleanup/`).

### 2. Evaluation set is ready but has no recordings

- `scripts/llm-eval.ts` + `docs/LLM-EVAL-SOP.md` implement the comparison
  (CER, digit preservation, change count, latency, candidate/fallback rates)
  and refuse to invent a dataset. The owner still needs to record 20–30 real
  samples; a synthetic TTS smoke (`docs/LLM-EVAL-SMOKE.md`) validates the chain
  but is not Go/No-Go.
- Go condition: self-correction/filler errors ≥20%, dangerous-sample retention
  100%, blind preference ≥55%. Below that, keep the default off and invest in
  hotwords/vocabulary.

### 3. Spike disposition

- Draft PR #25 proved the sidecar path but is not merged as-is; its code was
  folded into the `llm-cleanup` change. Close #25 after the product PR lands,
  or keep it as the measurement record.

### 4. Qwen2.5-3B is excluded

- Qwen2.5-3B-Instruct is Qwen Research License (non-commercial) and its 85-char
  sample took 1.86 s (over the 1.5 s hard timeout). The default pool stays
  Apache-2.0: Qwen2.5-1.5B-Instruct / Qwen3-1.7B.

---

## 2026-11-02 — packaged runtime and release readiness

### 1. A packaged install could not transcribe (resolves item 11)

- **Observed (carried from the 2026-10-31 list):** the DMG shipped no ASR
  runtime, and the dylibs that did exist resolved through absolute paths into the
  build machine's checkout.
- **Now:** the runtime is staged into a flat `resources/runtime/` with
  `@loader_path` rpaths, shipped as `Contents/Resources/runtime/`, and resolved
  from `process.resourcesPath` when packaged. The packaging script validates the
  staged links and signatures before electron-builder runs.
- **Evidence:** the staged CLI transcribes `bench/fixtures/zh-4s.wav`; the
  packaged app, given a temporary `userData` containing only the SenseVoice
  weights, reaches 「模型就绪」 from the bundled runtime.
- **Contract:** `openspec/changes/packaged-runtime`.

### 2. Signing readiness (item 4)

- Prepared: `resources/entitlements.mac.plist`, `scripts/package-mac-signed.ts`
  (fails naming missing variables), `scripts/verify-mac-app.ts`, and documented
  env/commands in `docs/PACKAGING-RELEASE.md`.
- **Blocked:** no Developer ID certificate or notarytool credentials. The signed
  path is exercised only up to its environment check; the unsigned artifact is
  reported as expected.

### 3. Auto-update and crash diagnostics (items 5 and 6)

- Recorded, not implemented. Auto-update needs item 4 and a publish channel;
  diagnostics needs either a local log/export design or an upload endpoint with
  a privacy decision.

---

## 2026-11-01 — focus-aware delivery and first-run guide

### 1. Delivery had no safe target when focus was not editable

- **Observed (derived from the 2026-10-31 trial):** with JustSpeak unfocused, the app
  always pasted. Into Finder's desktop or a Chrome page surface, that keystroke had no
  destination, and the failure arrived only after the fact.
- **Probe:** macOS Accessibility returns `AXTextArea` for TextEdit/CotEditor/VS Code,
  `AXTextField` for a focused Chrome input, and `AXGroup`/`AXOutline`/`AXWebArea` for
  non-editable surfaces. A range alone is not evidence: Finder and Chrome advertise one.
- **Now:** delivery is insert (own window) → paste (editable element) → copy panel
  (non-editable or unreadable). The panel sits just above the pill position, never takes
  focus, shows the text with a copy action, and dismisses on copy, close, or Escape.
  History records the `panel` outcome.
- **Contract:** `openspec/changes/archive/2026-11-02-focus-panel-and-onboarding`.

### 2. The waveform kept moving while transcribing

- **Observed:** 「我们语音录入以后是波形变化，录完接着把语音转成文字，这中间有一段等待时间。我觉得在这个等待时间里，波形就不应该继续动了……」
  and then, after rejecting a separate Thinking/progress surface:
  「这样吧，这个点跟那个波形变成水平线的时候一样大，我们只要改变那个波形的颜色就好了」
- **Now:** the working form reuses the same 17 bars at their resting (flat-waveform) size.
  Their geometry, count, pill size and window never change; only colour does. A lit bar
  walks right one step at a time (90 ms hop + 20 ms hold), passed bars stay lit, and the
  active bar hops 4 px. The last bar is the completion signal. If delivery arrives first,
  the highlight jumps directly to the last bar before the pill hides; if the walk reaches
  the end first, it waits there. No text, no progress number, no new track.
- **Contract:** `openspec/changes/archive/2026-11-02-processing-walk`.

### 3. First-run guidance for permissions and destinations

- **Items carried from the 2026-10-31 list:** item 2 (Accessibility permission guidance)
  and item 3 (first-run onboarding).
- **Now:** the first launch shows one screen with the hotkey, the three destinations, and
  microphone/Accessibility status. Status is read without prompting, Accessibility
  deep-links to System Settings, and the screen re-checks when the window regains focus.
  Dismissal persists per user data.
- **Contract:** `openspec/changes/archive/2026-11-02-focus-panel-and-onboarding`.

---

## 2026-11-01 — history destination was a placeholder

### 1. Recognised text never appeared in 历史记录

- **Observed:** 「我都使用了，语音也识别成文字了，但是历史记录中什么都没有」
- **Was:** `HistoryPane.tsx` always rendered 「还没有记录」. Main did emit one
  `transcript` event per delivery, but no renderer subscribed to it and nothing
  was written to disk, so the text had been delivered correctly and was simply
  never recorded — not lost.
- **Now:** main appends every delivered transcript to
  `userData/history/entries.jsonl` with its local timestamp, duration, latency and
  delivery outcome, and saves the recording as 16 kHz mono PCM16 WAV under
  `userData/history/audio/`. 历史记录 groups rows by local day, newest first, with
  copy, delete and playback. Retention follows the plan card's frozen decisions
  (1000 text entries / 30 days; newest 500 audio files).
- **Contract:** `openspec/changes/archive/2026-11-01-transcription-history`
  (validated and archived 2026-11-01; main spec `openspec/specs/history/spec.md`).
  Automated evidence: unit tests for parsing/grouping/retention and the
  insert→outcome mapping, plus `tests/e2e/history.spec.ts`, which records
  against a temporary `userData` and checks the JSONL row, the WAV header,
  restart persistence, copy and delete. A one-off local probe with real
  SenseVoice and a WAV microphone also verified playback and the WAV bytes; it
  needs the downloaded model, so it is not part of the default suite. Owner
  accepted the development build on 2026-11-01.

---

## 2026-10-31 — first real-device trial (packaged build, local models)

### 1. No visible cue while dictating into another app

- **Observed:** 「我们在其他的 App 进行录音书写的时候，整个界面没有一个小小的标记」
- **Reference:** Typeless shows a small pill at the bottom centre of the screen
  while recording — `✕` on the left, a live waveform in the middle, `✓` on the
  right. No text.
- **Today:** the app creates one plain `BrowserWindow` (`src/main/index.ts:567`)
  with no `Tray`, no `alwaysOnTop`, and no blur/hide handling. The window is
  shown once on `ready-to-show` (`:584`) and the global hotkey only calls
  `toggleRecording()` (`:776-779`) — it never re-surfaces the window. Dictating
  while focused in another app therefore produces *no* feedback until the text
  is pasted, after the fact. (Line numbers are against `main` at the time of
  writing; re-check them before relying on one.)
- **Decision (owner, 2026-10-31):** form = **bottom-centre floating pill**, chosen
  over a menu-bar icon and a Dock badge; and **no text inside it** — iconography
  only, following Typeless.
- **Still open:**
  - what the pill shows while transcribing, on error, and on success;
  - whether `✕` cancels the recording and `✓` ends it (the pill implies both);
  - which display and where, with a menu bar, a Dock and multiple screens;
  - the pill must not take focus away from the app being dictated into;
  - whether it appears for every recording or only when JustSpeak is not frontmost.
- **Why it matters:** this is the only feedback channel during the seconds the
  user is speaking, and today it does not exist.

### 2. No first-run guidance for the Accessibility permission

- **Observed (indirect):** the paste step needs the app to simulate ⌘V, which
  needs 「辅助功能」 permission. Nothing in the UI asks for it or explains the
  failure.
- **Today:** `src/main/injection.ts` shells out to `osascript`; a refusal becomes
  `PASTE_PERMISSION_MESSAGE` (`src/core/injection/paste.ts:1-2`) shown as a
  status line. The transcript is kept on the clipboard, which is correct but not
  discoverable.
- **Done looks like:** detect the permission at first use, explain it in one
  sentence, deep-link to the right System Settings pane, and re-check on return.

### 3. No first-run onboarding

- **Observed:** a fresh install opens to an empty window that does not mention
  the hotkey, the model, or that dictation needs the window out of the way.
- **Done looks like:** one short first-run screen: the hotkey, where text goes,
  and the permission step from (2).

### 4. Distribution is unsigned and not notarised

- **Today:** `electron-builder.yml` still sets `mac.identity: null` and
  `mac.notarize: false` for local builds; `pnpm package:mac:artifacts` produces
  a working DMG and ZIP (verified 2026-10-31), but another machine will block it
  through Gatekeeper unless the user overrides the quarantine.
- **Prepared (2026-11-02):** `pnpm package:mac:signed` now exists. It refuses to
  start unless the release environment provides `CSC_NAME` and one complete
  notarisation credential pair, then turns on hardened runtime, the minimal
  `resources/entitlements.mac.plist` (`allow-jit` only), and notarisation.
  `pnpm verify:mac <app> --require-distribution` checks the finished bundle with
  `codesign`, `spctl`, and `stapler`, plus the shipped runtime against its
  manifest (link closure, `@loader_path` rpaths, arm64 slices, signatures). The
  unsigned local build reports `FAIL codesign verify` / `FAIL Gatekeeper`, which
  is the expected result of `identity: null`.
- **Blocked on:** a Developer ID Application certificate, a team ID, and
  `notarytool` credentials. The signed path has been exercised only up to its
  environment check, not end to end.

### 5. No auto-update

- No updater is configured. Every fix needs a manual reinstall.
- **Prerequisites (2026-11-02):** auto-update cannot be verified before item 4
  lands (Squirrel.Mac requires a Developer ID signature) and a publish channel
  exists (`publish: null` today). The next step is choosing GitHub Releases vs a
  generic HTTPS feed, then adding `electron-updater` and a release job that
  uploads `latest-mac.yml` with the signed artifacts. Not started.

### 6. No crash reporting or diagnostics export

- A failure reaches the user as one status line and reaches the maintainer
  nowhere. There is no bundled log bundle to ask for.
- **Now (2026-11-05):** shape (a) is implemented: a persistent, rotated
  main-process log, local `crashReporter` dumps, and a user-initiated **导出诊断**
  zip (summary, redacted logs, recent dumps) saved through a native dialog.
  Nothing is uploaded. The summary and logs exclude transcripts, audio, history
  text, vocabulary entries, API keys, and endpoint URLs; crash dumps are
  OS-generated process memory and may contain transient content or in-memory
  secrets (including a local sidecar API key or a decrypted endpoint key), so
  the user is told to inspect the zip before sharing. Shape (b), an upload
  endpoint with consent and retention rules, remains deferred.

### 7. Post-processing still produces wrong text in known cases

- **Observed in an earlier pass by running the pipeline directly** (not all of
  these are pinned by a test): 「他说．．」 → 「他说。.」; 「他说……不对，走了」 loses
  text; 「他，JustSpeak行。」 → 「他,JustSpeak行.」 (full-width punctuation and the
  personal-vocabulary boundary). `tests/postprocess.test.ts` covers the `……` /
  `...` separator run, not the full-width-dot form, so a fix here starts by
  turning each case into a failing test.
- **Done looks like:** each case pinned by a failing test first, then fixed.
- **Decision (2026-11-03):** the rule-based self-correction is removed
  entirely rather than patched again; the two other cases are independent
  deterministic bugs (punctuation-run membership and dominant-script detection
  ignoring mask placeholders) and are fixed in the same change. LLM correction
  research is in
  [ASR-CORRECTION-RESEARCH.md](ASR-CORRECTION-RESEARCH.md): the evidence supports
  hotwords/vocabulary plus an evaluation set first, with an optional
  constrained-decision LLM stage later — not free-form 1.5B/1.7B rewriting.
  Product wording must distinguish 「智能清理」 from 「AI 重写」.

### 8. Real-speech evaluation has no data

- `scripts/bench-real.ts` and `docs/REAL-SPEECH-SOP.md` are ready, but nothing
  has been recorded into `bench/real/` yet (the WAVs under `bench/fixtures/` and
  `models/runtime/` are synthetic or upstream), so the accuracy claim has no
  number behind it.

### 9. Platform and feature scope

- macOS arm64 only; Windows is a design doc (`docs/WINDOWS-PORT.md`).
- Silence-aware segmentation is experimental and configurable only through
  environment variables — there is no UI, and it is not mentioned in the app.

### 10. Packaged build could not find its model — path fixed in #16, runtime still missing (see 11)

- **Was:** `resolveAsrPaths` derived the runtime and weights from
  `app.getAppPath()`, which is a path inside the read-only `app.asar` once
  packaged, so a DMG install could neither find the model nor write a download.
- **Now:** `resolveModelsDir` uses `userData/models` when packaged and the
  repository's `models/` in a dev checkout. Verified on the installed app.
- **Status:** path resolution fixed in PR #16 — a packaged build now looks in
  `userData/models` instead of inside `app.asar`. That was necessary but not
  sufficient; see item 11, which is now resolved. The trial build only reached
  「模型就绪」 because the whole `models/` tree, runtime included, had been copied
  into `userData` by hand.

### 11. The packaged app has no way to obtain the ASR runtime

- **Was hidden by item 10:** fixing where the app *looks* exposed that nothing
  ever puts the runtime there.
  - `electron-builder.yml` ships only `out/`, `package.json`,
    `resources/models.json`, the notices and `licenses/`. It does not ship
    `transcribe-cli`.
  - The first-run download fetches `model.files[0]` (the weights) only; there is
    no runtime download.
  - `initializeProvider` tests `existsSync(paths.cliPath)` *before* the weights
    download (`src/main/index.ts:391`), so a clean install never gets far enough
    to download anything.
- **Measured on the pinned runtime (v0.4.1, arm64):** the binary plus what it
  loads is about 9 MB — `transcribe-cli` 162 KB, `libtranscribe.0.4.1.dylib`
  1.9 MB, `libggml.0.26.0` 59 KB, `libggml-cpu.0.26.0` 959 KB,
  `libggml-base.0.26.0` 720 KB, `libggml-metal.0.26.0` 5.3 MB.
- **The blocker:** those dylibs are found through `@rpath` entries baked at build
  time as **absolute paths into the build machine's checkout**
  (`/Users/fuyg/workspace/.../models/runtime/transcribe.cpp/build/{src,ggml/src,ggml/src/ggml-metal}`).
  Copying the tree next to the app does not help on any other machine, and the
  trial on this machine only worked because the repository copy still sits at
  those absolute paths.
- **Now (2026-11-02):** `scripts/package-runtime.ts` stages the CLI and five
  dylibs into a flat `resources/runtime/`, deletes every absolute `LC_RPATH`,
  adds `@loader_path`, re-signs each binary ad-hoc (`install_name_tool`
  invalidates the arm64 signature), and copies the runtime license texts.
  `extraResources` ships the directory as `Contents/Resources/runtime/`; a
  packaged app resolves the CLI from `process.resourcesPath/runtime` and keeps
  weights in `userData/models`. Verified by launching the packaged app with a
  temporary `userData` containing only the weights: it reached 「模型就绪」from
  the bundled runtime, with no manual copy of `models/runtime`.
- **Still open:** the clean-install check on another Mac and with a *signed*
  build (item 4); the unsigned artifact cannot pass Gatekeeper.
- **Decision taken:** execute the runtime from the app bundle (signed with the
  app) rather than a user-writable `userData` path, matching
  `docs/PACKAGING-RELEASE.md`. Contract:
  `openspec/changes/packaged-runtime`.

### 12. The main window had no design system

- **Observed:** 「UI好丑呀，你好好看看，如何调整」 — after the sidebar shell landed.
- **Today:** the first shell was a structural change, not a visual one: 30 px
  slogan heading, a provider `<select>` and an appearance read-out competing in
  one row, a full-height bordered textarea, text-only sidebar items, and the
  window was not draggable at all (`titleBarStyle: 'hiddenInset'` with no
  drag region anywhere).
- **Decision (owner, 2026-10-31):** the "card workbench" layout, with a palette
  chosen against a three-plane system: macOS semantic surfaces + one brand accent
  ("graphite + pine"). Accent under 5% of the surface; amber means working, red
  means recording or failure.
- **Made it in:** `app-shell` change, `src/renderer/src/styles.css` tokens.
- **Still open:** native materials (`vibrancy`) as an optional layer; a
  "follow system accent colour" setting; the packaged build has not been
  re-screenshotted.

---

## How to use this file

- One dated section per review round; keep items numbered within a round.
- Each item: what was observed (quote the owner), what the code does today with
  file references, what "done" looks like, and any decision already taken.
- Move an item out only when it becomes an OpenSpec change or a merged PR; link
  the PR/change from the item when that happens.
