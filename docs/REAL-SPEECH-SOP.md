# Real-Speech Evaluation SOP

How to record, convert, label, and score real dictation samples with
`scripts/bench-asr.ts --real`. The synthetic fixture in `bench/fixtures/` stays
as the repeatable smoke benchmark; this SOP covers the human-voice quality
evidence.

- Samples live in `bench/real/`, which is **gitignored**.
- The JSON and Markdown outputs are also gitignored because they contain
  transcript text.
- The harness reads the pinned model and runtime from `resources/models.json`
  and never downloads anything. Run `pnpm setup:asr` once beforehand.

## 1. Recording protocol

Use the same input device for every sample (MacBook built-in microphone or one
wired headset). Do not mix devices within a tag set — a device change shows up
as an accuracy change.

- **Distance:** 15–20 cm from the microphone, slightly off-axis. Do not move
  closer for noisy samples.
- **Pace:** speak naturally at your normal dictation pace. Do not over-articulate
  or slow down; the benchmark should measure the product's real input.
- **Bracketing:** pause about 0.5 s before and after the sentence. Say exactly
  the text that will be written into the manifest.
- **One take per file.** If you flub a word, re-record the whole sample rather
  than trimming it.
- **Content:** 8–25 Chinese characters or 3–12 English words. Include names,
  numbers, and a few English technical terms in `mixed` samples.

### Quiet protocol

- No other speakers, no fan/HVAC, window closed.
- Aim for a room noise floor below about 35 dBA.
- Record at least 5 quiet samples.

### Noisy protocol

- Use one controlled noise source for every noisy sample (for example a fan, or
  speech played back at low volume from another device).
- Aim for about 45–55 dBA at the microphone: audible but not shouting distance.
- Do not change the noise source between noisy samples.
- Record at least 5 noisy samples.

### Sample counts per tag

Tags are independent: each sample gets one `environment`, one `language`, and
one `length`. Twelve to twenty samples can cover the table below.

| Dimension | Values | Minimum per value |
|---|---|---|
| `environment` | `quiet`, `noisy` | 5 each |
| `language` | `zh`, `en`, `mixed` | 4 `zh`, 4 `en`, 3 `mixed` |
| `length` | `short` (< 3 s), `medium` (3–10 s), `long` (10–30 s) | 3 each |

## 2. Convert to 16 kHz mono PCM16

Record with QuickTime Player (File → New Audio Recording) or Voice Memos, then
convert with `afconvert`. `--no-filler` keeps the canonical 44-byte PCM header;
the harness rejects real samples whose audio data does not start at byte 44.

```bash
mkdir -p bench/real

afconvert --no-filler \
  -f WAVE -d LEI16@16000 -c 1 \
  ~/Desktop/recordings/take-01.m4a \
  bench/real/quiet-zh-short-01.wav
```

Check the result before labelling:

```bash
afinfo bench/real/quiet-zh-short-01.wav | grep -E "File type|Data format|estimated duration"
```

Expected: `WAVE`, `16000 Hz`, `1 ch`, `16-bit integer`. If `afinfo` shows a
different rate or channel count, re-run the conversion with the exact command
above instead of editing the file.

## 3. Naming convention

```
<environment>-<language>-<length>-<nn>.wav
```

Examples: `quiet-zh-short-01.wav`, `noisy-en-medium-02.wav`,
`quiet-mixed-long-03.wav`.

- `environment`: `quiet` or `noisy`
- `language`: `zh`, `en`, or `mixed`
- `length`: `short`, `medium`, or `long`
- `nn`: two-digit sequence number, starting at `01`

Keep the file name and the manifest `path` identical. The manifest `tags` must
match the file name; the harness scores by tags, not by parsing the name.

## 4. Manifest

Create `bench/real/manifest.json`:

```json
{
  "samples": [
    {
      "id": "quiet-zh-short-01",
      "path": "quiet-zh-short-01.wav",
      "text": "这是语音识别测试，今天天气很好。",
      "tags": { "environment": "quiet", "language": "zh", "length": "short" }
    },
    {
      "id": "noisy-en-medium-02",
      "path": "noisy-en-medium-02.wav",
      "text": "Please schedule the design review for next Tuesday at three thirty.",
      "tags": { "environment": "noisy", "language": "en", "length": "medium" }
    }
  ]
}
```

Rules enforced by the harness:

- `samples` must be an array; each sample needs non-empty `id`, `path`, `text`,
  and `tags.environment`, `tags.language`, `tags.length`.
- `id` values must be unique.
- `path` must be relative and must stay inside `bench/real/` (no `..`).
- Audio must be 16 kHz mono PCM16 with the canonical 44-byte header.
- Malformed JSON or a wrong format fails loudly. A missing or empty manifest is
  the empty state: the command prints `no real samples yet` and exits 0.

## 5. Run and read the report

```bash
pnpm bench:asr --real
```

Outputs:

- `bench/results/<date>-real.json` — per-sample metrics and per-tag rollups.
- `bench/reports/<date>-real.md` — the human-readable summary.

The command prints one line per sample and exits 1 if any sample fails to
decode or transcribe. It exits 0 in the empty state.

Each sample reports:

- audio duration, stop→final latency, and RTF (`latency / audio`);
- detected language;
- CER against the manifest `text`;
- substitutions / deletions / insertions and an aligned diff such as
  `今天天气很[好→坏]`, where `[x→y]` is a substitution, `[-x]` a deletion, and
  `[+x]` an insertion.

Rollups are emitted for every `environment`, `language`, and `length` value with
mean CER and p50/p95 stop→final latency. Percentiles use linear interpolation.

## 6. What "good enough" looks like

These are judgement targets from the product latency requirements, not hard CI
gates. Record the actual numbers in the report and compare like for like.

| Signal | Target |
|---|---|
| CER, quiet `zh` / `en` | ≤ 5% |
| CER, `mixed` | ≤ 10% |
| CER, `noisy` | ≤ 15% |
| Stop→final p50 | ≤ 1500 ms |
| Stop→final p95 | ≤ 3000 ms (10 s utterance) |
| Provider-path RTF | ≤ 0.3 warm |
| Detected language vs tag | matches on ≥ 90% of samples |

Interpretation:

- A few punctuation-only differences should disappear after normalization; if
  they do not, inspect the diff before treating it as an accuracy failure.
- Consistent substitutions of names or technical terms are a vocabulary issue.
- Random deletions/insertions across quiet samples usually mean the microphone
  was too far away, clipped, or the wrong device was selected.
- A large latency outlier on the first sample is cold start; compare p50/p95
  rather than the first row alone.

## 7. Privacy

Real recordings and their results are personal data.

- Never `git add -f bench/real/` and never commit `*-real.json` /
  `*-real.md`.
- `git check-ignore -v bench/real/manifest.json` should report an ignore rule.
- Delete `bench/real/` when the recordings are no longer needed; the harness
  recreates nothing on its own.
