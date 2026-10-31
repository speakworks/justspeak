# Product feedback backlog

Owner trial notes, newest first. This file is a running list of *observed*
problems and the decisions taken about them — it is not a spec and nothing here
is scheduled until it is picked up. Behaviour contracts, when one of these turns
into work, belong in `openspec/`; implementation notes belong in the ADRs.

Add a dated section per review round. Keep the owner's wording verbatim (the
Chinese quotes) so the intent survives paraphrasing, and record the evidence
that makes each item checkable.

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

### 10. Packaged build could not find or download its model — FIXED, not yet merged

- **Was:** `resolveAsrPaths` derived the runtime and weights from
  `app.getAppPath()`, which is a path inside the read-only `app.asar` once
  packaged, so a DMG install could neither find the model nor write a download.
- **Now:** `resolveModelsDir` uses `userData/models` when packaged and the
  repository's `models/` in a dev checkout. Verified on the installed app.
- **Status:** committed on branch `fix/packaged-models-dir` (`8757ae8`), not
  merged. (Owner observation, not verifiable from this commit: the build
  installed for the trial was made from that branch and does reach 「模型就绪」.)

---

## How to use this file

- One dated section per review round; keep items numbered within a round.
- Each item: what was observed (quote the owner), what the code does today with
  file references, what "done" looks like, and any decision already taken.
- Move an item out only when it becomes an OpenSpec change or a merged PR; link
  the PR/change from the item when that happens.
