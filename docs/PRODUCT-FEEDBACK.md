# Product feedback backlog

Owner trial notes, newest first. This file is a running list of *observed*
problems and the decisions taken about them — it is not a spec and nothing here
is scheduled until it is picked up. Behaviour contracts, when one of these turns
into work, belong in `openspec/`; implementation notes belong in the ADRs.

Add a dated section per review round. Keep the owner's wording verbatim (the
Chinese quotes) so the intent survives paraphrasing, and record the evidence
that makes each item checkable.

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

- **Today:** `electron-builder.yml` sets `mac.identity: null` and
  `mac.notarize: false`; `pnpm package:mac:artifacts` produces a working DMG and
  ZIP (verified 2026-10-31), but another machine will block it through
  Gatekeeper unless the user overrides the quarantine.
- **Blocked on:** a Developer ID Application certificate, a team ID, and
  `notarytool` credentials.

### 5. No auto-update

- No updater is configured. Every fix needs a manual reinstall.

### 6. No crash reporting or diagnostics export

- A failure reaches the user as one status line and reaches the maintainer
  nowhere. There is no bundled log bundle to ask for.

### 7. Post-processing still produces wrong text in known cases

- **Observed in an earlier pass by running the pipeline directly** (not all of
  these are pinned by a test): 「他说．．」 → 「他说。.」; 「他说……不对，走了」 loses
  text; 「他，JustSpeak行。」 → 「他,JustSpeak行.」 (full-width punctuation and the
  personal-vocabulary boundary). `tests/postprocess.test.ts` covers the `……` /
  `...` separator run, not the full-width-dot form, so a fix here starts by
  turning each case into a failing test.
- **Done looks like:** each case pinned by a failing test first, then fixed.

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
  `userData/models` instead of inside `app.asar`. **That is necessary but not
  sufficient:** see item 11. The trial build only reached 「模型就绪」 because the
  whole `models/` tree, runtime included, had been copied into `userData` by
  hand.

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
- **Done looks like:** rewrite each dylib's dependency paths and `@rpath` to
  `@loader_path`-relative (`install_name_tool -change` / `-add_rpath`, or a build
  that emits them), ship the ~9 MB set via `extraResources` into
  `Contents/Resources/runtime/...`, resolve the runtime from there when packaged,
  and keep the weights download where it is. Then a clean DMG install works with
  no manual steps.
- **Also worth deciding:** whether executing the runtime from the app bundle
  (signed with the app) is preferred over the current interim of a user-writable
  `userData` path — `docs/PACKAGING-RELEASE.md` describes the former.

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
