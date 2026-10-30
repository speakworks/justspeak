# License texts shipped with JustSpeak

`THIRD_PARTY_NOTICES.md` records the license identifier and source of every
component the app ships or downloads. This directory carries the full text that
identifier points at, because an identifier alone is not a license grant.

These files are copied into the packaged app's `Contents/Resources/licenses/`
(see `extraResources` in `electron-builder.yml`), next to
`Contents/Resources/THIRD_PARTY_NOTICES.md`. Electron's own `LICENSE` and
`LICENSES.chromium.html` are copied from `node_modules/electron/dist` at build
time rather than committed here — they are 5 MB of generated HTML that would
only duplicate what the Electron distribution already contains.

| File | License | Applies to |
| --- | --- | --- |
| `MIT-JustSpeak.txt` | MIT | JustSpeak itself (`LICENSE` at the repository root) |
| `MIT-react.txt` | MIT | `react` |
| `MIT-react-dom.txt` | MIT | `react-dom` |
| `MIT-scheduler.txt` | MIT | `scheduler` |
| `MIT-transcribe.cpp.txt` | MIT | `transcribe.cpp` ASR runtime (pinned v0.4.1) |
| `Apache-2.0.txt` | Apache-2.0 | Qwen3-ASR 0.6B weights, and any Apache-2.0 code |
| `FunASR-Model-License-1.1.txt` | FunASR-Model-License-1.1 | SenseVoice Small weights |
| `Electron-LICENSE.txt` | MIT | Electron (copied at build time) |
| `Electron-LICENSES.chromium.html` | Chromium's component licenses | Chromium and Node.js inside Electron (copied at build time) |

## Weights are not redistributed

Neither model's weights are bundled. `resources/models.json` pins each artifact's
URL, revision, and SHA-256; the app downloads them on first run into the user's
data directory. The FunASR Model License v1.1 (§2.2) requires attributing the
source and author and retaining the model names — that is what the notices file
and the in-app model line do — but whether a *conversion* published by a third
party carries the same terms is still open with counsel. See
`docs/LICENSING.md` for the review questions and their status.

## Keeping this in sync

`tests/packaging.test.ts` fails when `THIRD_PARTY_NOTICES.md` names a license
identifier that has no text here, and when the builder configuration stops
shipping either the notices file or this directory.
