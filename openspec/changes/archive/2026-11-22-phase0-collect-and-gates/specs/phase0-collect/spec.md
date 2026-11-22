# phase0-collect Specification

## Purpose

Turn a folder of recordings into the Phase 0 grid without a hand-transcription
step, and keep every unobserved cell recognisable as unobserved. The collector
supplies the mechanical part of the gate — names, rows, coverage, endpoint
measurement — so the owner spends time on audio, not on copying numbers.

## Requirements

### Requirement: The collector SHALL accept only the canonical recording names and report the rest

A recording filename SHALL be `rec-NN.wav` with a two-digit index from 01 to 20.
Any `.wav` that does not match, any index above 20, and any duplicate index
SHALL be reported as a problem naming the file and the expectation. Missing
segments SHALL be listed individually.

#### Scenario: A folder with a badly named file

- **WHEN** the folder contains `recording-01.wav`
- **THEN** no row is produced for it
- **AND** the report's problem list names the file and the `rec-NN.wav` pattern

#### Scenario: A complete folder

- **WHEN** all 20 canonical names are present
- **THEN** the problem list is empty
- **AND** the discovered order is `rec-01` … `rec-20`

### Requirement: The grid SHALL always render 20 × 3 rows

The rendered table SHALL contain one row per recording × route combination
regardless of how many recordings exist, so gaps are visible rather than absent.
Rows with no recording SHALL show `待填` in every measurement column.

#### Scenario: Empty folder

- **WHEN** no recording exists
- **THEN** the table has 60 data rows, each showing `待填`
- **AND** the header states the coverage as 0 of 60 rows generated

### Requirement: A cell SHALL hold a number only when that column was measured

A measured column SHALL render its P50. A blocked or skipped column SHALL render
its status word, never `0`. M1 SHALL be produced only when all four columns of
that row were measured, and SHALL be labelled as the arithmetic sum of the four
P50s rather than a listening-check value.

#### Scenario: ASR blocked

- **WHEN** the ASR runtime is absent
- **THEN** the ASR cell shows `blocked`
- **AND** the row's M1 cell shows `blocked`, not the sum of the three measured columns

#### Scenario: All four measured

- **WHEN** endpoint, ASR final, LLM first token and TTS first packet all have samples
- **THEN** M1 is their P50 sum and its detail says it is arithmetic, not M1 as heard

### Requirement: The report SHALL state that routes do not re-measure the input side

The collector SHALL measure input-side segments once per recording and the
output-side segment once per route, and SHALL state that in the artefact so a
filled grid is not read as 60 independent measurements.

#### Scenario: Three routes in one run

- **WHEN** the collector runs with `--routes built-in,wired,bluetooth`
- **THEN** each recording yields three rows
- **AND** the report notes that only the TTS column differs between them

### Requirement: The endpoint column SHALL be measured from the recording, and refuse an unconfirmable clip

Endpoint latency SHALL be computed by walking the live VAD windows over the
decoded PCM, from the last frame above the start threshold to the frame that
confirms `minSilenceMs` of quiet. A clip that ends while speech is still open,
or holds no region long enough to count as speech, SHALL be `blocked` with the
reason.

#### Scenario: A clip with a proper tail

- **WHEN** the clip ends with at least `minSilenceMs` of quiet after the last loud frame
- **THEN** the endpoint column reports measured milliseconds including the hysteresis tail
- **AND** the detail names the thresholds used

#### Scenario: A clip that ends mid-speech

- **WHEN** the recording stops while the detector is still open
- **THEN** the endpoint column is `blocked` with the reason that the stream would still be waiting

### Requirement: The collector SHALL offer a parse-only mode

`--list` SHALL read the folder, report names and gaps, and exit without opening
the ASR runtime, the sidecar or the TTS probe.

#### Scenario: Checking a folder before measuring

- **WHEN** the operator runs `pnpm bench:latency:collect --list`
- **THEN** discovered recordings and problems are printed
- **AND** no model, sidecar or Electron process is started
