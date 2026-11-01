## Context

The dictation pipeline already emits a `TranscriptEvent` before delivery, and
delivery returns which target ran (`insert` or `paste`). That is enough to record
what the user saw without teaching the provider or the session about storage.
The plan card left four open questions; this change answers them.

## Considered solutions

| # | Question | Decision | Why |
|---|----------|----------|-----|
| A | Storage shape | JSONL + one WAV per entry | No native dependency, append is one syscall, and a corrupt line can only lose one row. SQLite was rejected for a 1000-row ceiling. |
| B | Audio format | 16 kHz mono PCM16 WAV, no transcode | Exactly what capture produces; playback needs no decoder beyond the browser's WAV support. |
| C | Outcome capture | Session controller reports a settlement after delivery | Keeps the existing "send transcript before paste" contract, and a failed paste still records the text that reached the clipboard. |
| D | Cleanup timing | Startup plus after each append | The append path already holds the file lock; no timer or wedged background job. |

## Storage layout

```
userData/history/
  entries.jsonl      one JSON object per line, newest-first after a rewrite
  audio/<entry-id>.wav
```

`HistoryStore` serialises every mutation through one promise queue. Appends use
`appendFile`; removals and retention rewrites go through a temp file and
`rename`. A delete removes the WAV before the row, so a crash leaves an orphan
file (cleaned on the next startup) rather than a row pointing at nothing.

## Retention

`planHistoryRetention` is pure and decides three sets: rows to keep, rows to
remove, and audio refs to strip from surviving rows. The store deletes the audio
files first, then rewrites the row file, then removes unreferenced WAVs.

## Renderer boundary

The pane reads rows through `getHistory`, is told about changes through
`history:changed`, and asks for playback bytes through `getHistoryAudio`, which
returns an `ArrayBuffer`. No file path crosses the sandbox boundary, and copy
uses main's clipboard rather than `navigator.clipboard` (the renderer is not a
secure context).

## Failure policy

Recording a transcript is a convenience: `HistoryStore.append` rejects are
caught in main and logged. Audio write failures are caught inside the store and
still append the text row.
