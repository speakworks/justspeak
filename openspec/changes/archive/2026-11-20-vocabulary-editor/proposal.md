## Why

The vocabulary file is already applied to transcription, but the only way to
change it is to hand-edit `userData/vocabulary.json`. The 词典 destination shows
counts and a path, so a user who wants to add a name has to leave the app, find
the file, learn its JSON shape, and restart the read path. This change makes the
destination an editor while keeping the file as the single source of truth.

## What Changes

- Add three editable sections to the 词典 destination: decode-time terms,
  `from => to` replacements, and protected words. Each supports add, edit, and
  delete.
- Add one batch-paste box per section. A paste is split on lines, trimmed,
  de-duplicated in the section, and reports how many lines were duplicates or
  invalid. Replacement lines use `from => to`; a missing arrow or an empty side
  is an invalid line, never a silent drop.
- Add a save action that sends the three lists to main. Main re-normalises the
  payload through the same parser the file read path uses, writes the file
  atomically (temporary file plus rename), reads it back, and only then updates
  the in-memory options used by the next dictation. A failed write leaves the
  old file and the old in-memory options untouched.
- The settings view now carries the accepted term, replacement, and protect
  entries so the editor can start from what is on disk. Counts stay derived from
  a fresh read-back.
- Keep the existing "当前 ASR 模型不支持解码期术语偏置，术语未生效。" notice while
  editing, because editable terms on SenseVoice still do not reach the decoder.
- Ship a ten-term starter list as a read-only resource and offer an explicit
  `载入起始词表（10 词）` action. It never writes on first run, merges
  idempotently with existing terms (existing first, missing starter terms
  appended in order), and uses the same save path as a manual edit.
- No vocabulary content ships with the change: no default words, fixtures, or
  business word list. The starter resource is loaded only on an explicit click.

## Capabilities

### New Capabilities

- `vocabulary-editor`: editing, batch import, validation, atomic save, and
  read-back behaviour of the vocabulary surface.

### Modified Capabilities

- `settings-surface`: the 词典 destination is now an editor, and its view carries
  the accepted entries in addition to counts.

## Impact

- `src/core/postprocess/vocabulary.ts`: batch import parsers and save-payload
  normalisation.
- `src/main/vocabulary-store.ts`: atomic write through a temporary file.
- `src/main/vocabulary-save.ts`: the testable save-and-read-back step.
- `resources/vocabulary-starter.json`, `src/main/vocabulary-starter.ts`: the
  single source of the explicit starter list.
- `src/main/index.ts`: the `vocabulary:save` handler and view wiring.
- `src/shared/ipc.ts`, `src/preload/index.ts`: the new save channel.
- `src/renderer/src/SettingsPanel.tsx`, `src/renderer/src/App.tsx`,
  `src/renderer/src/styles.css`: the editor surface.
- `docs/VOCABULARY.md`: the editor is now the normal path; the file stays
  hand-editable.
