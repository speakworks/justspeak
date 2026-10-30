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
| `NOTICE-Qwen3-ASR-0.6B-gguf.txt` | Apache-2.0 §4(d) | Qwen3-ASR GGUF conversion: reproduces the conversion repo's NOTICE (§4(b) source of the change statement) |
| `NOTICE-SenseVoiceSmall-gguf.txt` | Apache-2.0 §4(d) | SenseVoice GGUF conversion: reproduces the conversion repo's NOTICE (§4(b) source of the change statement) |
| `Electron-LICENSE.txt` | MIT | Electron (copied at build time) |
| `Electron-LICENSES.chromium.html` | Chromium's component licenses | Chromium and Node.js inside Electron (copied at build time) |

## Weights are not redistributed

Neither model's weights are bundled. `resources/models.json` pins each artifact's
URL, revision, and SHA-256; the app downloads them on first run into the user's
data directory.

What the two conversion repositories actually carry, checked on 2026-10-31:

- `Qwen3-ASR-0.6B-gguf` ships a `LICENSE` byte-identical to Apache-2.0 and a
  `NOTICE` naming the upstream commit and what the conversion changed.
- `SenseVoiceSmall-gguf` ships a `LICENSE` byte-identical to the FunASR Model
  License v1.1 and a `NOTICE` of the same shape.

So the conversions do not introduce different terms; the texts above are the ones
that govern them. Still open, and tracked in `docs/LICENSING.md` for review before
any commercial release: whether the maintainers' informal clarification covers
conversions at all, and the exact attribution wording FunASR §2.2 requires.

## Keeping this in sync

`tests/packaging.test.ts` maps each component in `THIRD_PARTY_NOTICES.md` to the
exact file above and fails if one is missing — matching on a license *family*
would let `MIT-JustSpeak.txt` stand in for every third-party MIT holder. It also
fails when the builder configuration stops shipping the notices file, this
directory, or the two Electron texts.
