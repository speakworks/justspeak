# text-postprocess Specification

## Purpose
Defines the deterministic transcript-cleaning stage that runs between the ASR result and the paste call: Unicode and punctuation normalisation, filler removal, repetition collapse, self-correction cleanup, and a local personal vocabulary. The stage is pure, offline, and individually configurable.

## Requirements

### Requirement: The stage SHALL be pure and deterministic

`postprocess(text, options)` SHALL return `{ text, applied }` using only its arguments. It SHALL NOT import Electron, DOM, or Node filesystem APIs, SHALL NOT perform network or LLM calls, SHALL NOT read the clock, and SHALL return the same output plus the same ordered `applied` rule ids for the same input and options.

#### Scenario: Same input twice

- **WHEN** the same text and options are passed twice
- **THEN** both calls return identical `text` and `applied` values

#### Scenario: No side channels

- **WHEN** the module is imported by the core test suite
- **THEN** it resolves without Electron, DOM, filesystem, or network access

#### Scenario: Applied rules are truthful

- **WHEN** a rule changes the text
- **THEN** its id appears in `applied` in execution order
- **AND** a rule that changes nothing does not appear

### Requirement: Normalisation SHALL be conservative

The stage SHALL apply Unicode NFKC, collapse repeated whitespace, trim, remove stray spacing before punctuation, and convert punctuation to the dominant script. It SHALL NOT edit code-like tokens, including backtick spans, URLs, emails, paths, versions, numbers with units, environment variables, CLI flags, and code identifiers.

#### Scenario: Full-width input

- **WHEN** the transcript contains full-width Latin letters or digits
- **THEN** NFKC converts them to their ASCII forms

#### Scenario: Chinese-dominant text

- **WHEN** Han characters at least match the number of Latin word runs
- **THEN** ASCII `, . ! ? : ;` adjacent to Han become `，。！？：；`
- **AND** a full stop needs Han on its left, so an abbreviation such as `e.g.` followed by Chinese is not rewritten

#### Scenario: Latin-dominant text

- **WHEN** Latin word runs outnumber Han characters
- **THEN** `，。！？：；、` become `, . ! ? : ; ,`

#### Scenario: Code-like token

- **WHEN** the transcript contains `pnpm test`, `v1.2.3`, `foo_bar`, `1.5`, an email, a URL, or a path
- **THEN** the token is returned byte-for-byte
- **AND** surrounding prose punctuation is still normalised

### Requirement: Filler removal SHALL avoid real words

The stage SHALL remove the standalone Chinese fillers `嗯`, `呃`, `啊`, `那个`, and `就是说`, and the English fillers `um`, `uh`, and `er`, when they are set off from surrounding words. It SHALL remove `like` and `you know` only when punctuation or the start/end of the text sets them off. It SHALL NOT delete a filler that is part of a real word or phrase.

#### Scenario: Chinese filler

- **WHEN** the transcript is `嗯，我觉得可以。`
- **THEN** the output is `我觉得可以。`

#### Scenario: Filler inside a word

- **WHEN** the transcript is `那个东西很好。` or `好啊。` or `her umbrella`
- **THEN** the text is unchanged

#### Scenario: Ambiguous English filler

- **WHEN** the transcript is `I like it.`
- **THEN** `like` is preserved
- **AND** `I, like, think it works.` becomes `I think it works.`

### Requirement: Repetition collapse SHALL be bounded

The stage SHALL collapse an immediately repeated Latin word (`the the` to `the`), an immediately repeated Han character (`我我我` to `我`) when the run reaches the configurable threshold, and duplicated identical punctuation. It SHALL preserve legitimate Chinese AA reduplication (`谢谢`, `妈妈`), laughter (`哈哈哈`), grammatical English doubles (`had had`, `that that`), and a three-dot ellipsis.

#### Scenario: Stutter

- **WHEN** the transcript is `我我我觉得可以。`
- **THEN** the output is `我觉得可以。`

#### Scenario: Legitimate reduplication

- **WHEN** the transcript is `谢谢你的帮助。` or `妈妈来了。` or `Wait...`
- **THEN** the text is unchanged

#### Scenario: Configurable threshold

- **WHEN** `repetitionThreshold` is 3
- **THEN** `我我走了。` is unchanged and `我我我走了。` becomes `我走了。`

### Requirement: Personal vocabulary SHALL be local and applied first

The stage SHALL read a word list from `userData/vocabulary.json` with `replace` (`from` to `to`) and `protect` entries. Replacement SHALL run before normalisation, longest match first; ASCII entries SHALL match case-insensitively on word boundaries, and CJK entries SHALL match literally. Protected entries SHALL be masked before any rule, including NFKC, so no rule can edit them. A missing, corrupt, or non-object file SHALL resolve to defaults without throwing.

#### Scenario: Correction

- **WHEN** `replace` maps `库贝内特斯` to `Kubernetes`
- **THEN** `用库贝内特斯部署。` becomes `用Kubernetes部署。`

#### Scenario: Word boundary

- **WHEN** `replace` maps `cat` to `dog`
- **THEN** `cat` becomes `dog` and `concatenate` is unchanged

#### Scenario: Protect wins

- **WHEN** `protect` contains a token that a replacement would also match
- **THEN** the protected token is returned unchanged

#### Scenario: Bad file

- **WHEN** `vocabulary.json` is missing, corrupt, or not an object
- **THEN** the stage runs with default options and no error

### Requirement: Self-corrections SHALL drop the abandoned fragment

The stage SHALL treat `不对`, `我是说`, `no wait`, and `I mean` as correction markers only when punctuation or the start of the text sets them off and replacement content follows. It SHALL delete the clause before the marker through the marker and its trailing separator, SHALL keep earlier clauses, and SHALL treat a run of markers as one correction.

#### Scenario: Chinese correction

- **WHEN** the transcript is `周一发，不对，周二发。`
- **THEN** the output is `周二发。`

#### Scenario: Earlier clause survives

- **WHEN** the transcript is `先做A，然后B，不对，我是说C。`
- **THEN** the output is `先做A，C。`

#### Scenario: Marker-shaped phrase

- **WHEN** the transcript is `这个不对。` or `The fact that I mean it is fine.`
- **THEN** the text is unchanged

### Requirement: A non-empty transcript SHALL never become empty

If every enabled rule would delete the whole input, the stage SHALL return the original text with an empty `applied` list. The session SHALL also fall back to the raw provider text when an injected stage returns empty for a non-empty result.

#### Scenario: Filler-only utterance

- **WHEN** the transcript is `嗯，呃，啊`
- **THEN** the output is the original text
- **AND** no rule is reported as applied

#### Scenario: Empty input

- **WHEN** the transcript is `''`
- **THEN** the output is `''`

### Requirement: Every rule SHALL be individually disableable

`vocabulary`, `normalize`, `self-correction`, `filler`, and `repetition` SHALL each be disableable through `rules`, and an omitted rule SHALL be enabled. Protection SHALL remain active even when `vocabulary` is disabled because it only prevents edits.

#### Scenario: One rule off

- **WHEN** `rules.filler` is false
- **THEN** `嗯，我觉得可以。` is unchanged

#### Scenario: Vocabulary off, protection on

- **WHEN** `rules.vocabulary` is false and `protect` contains a token
- **THEN** replacements do not run and the protected token is still untouched

### Requirement: Plain prose SHALL pass through unchanged

With default options, text that needs no cleanup SHALL be returned exactly as received with no applied rules.

#### Scenario: Clean Chinese and English

- **WHEN** the transcript is `今天天气很好，我们去公园散步。` or `The quick brown fox jumps over the lazy dog.`
- **THEN** the output equals the input and `applied` is empty
