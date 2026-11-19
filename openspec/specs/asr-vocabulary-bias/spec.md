# asr-vocabulary-bias Specification

## Purpose
TBD - created by archiving change asr-vocabulary-bias. Update Purpose after archive.

## Requirements

### Requirement: The vocabulary file SHALL accept an ordered, bounded terms list

The vocabulary file SHALL accept a top-level `terms` array alongside `replace`
and `protect`. Parsing SHALL trim each entry, discard empty entries,
de-duplicate exact matches while preserving first-occurrence order, and keep at
most the first 32 accepted terms. A term containing U+002C SHALL be dropped and
counted as a parse-time discard because the runtime tokenises `--vocabulary` on
that character; the discard reason SHALL be available to the settings surface as
a count, never as term content. A missing, non-array, or invalid `terms` value
SHALL resolve to an empty list without throwing and without changing how
`replace`, `protect`, `rules`, or `repetitionThreshold` are parsed. Serializing
the vocabulary file SHALL preserve the accepted `terms` list so writing through
the existing store never erases it.

#### Scenario: A file written before terms existed

- **WHEN** `vocabulary.json` contains `replace` and `protect` but no `terms`
- **THEN** it loads with an empty term list
- **AND** `replace` and `protect` apply exactly as before

#### Scenario: Trim, order, and de-duplication

- **WHEN** the file stores `terms` as `[' Kubernetes ', 'Kubernetes', '', 'GPT-4o']`
- **THEN** the accepted list is `['Kubernetes', 'GPT-4o']`
- **AND** the original order of first occurrences is preserved

#### Scenario: A term containing an ASCII comma is dropped visibly

- **WHEN** a configured term contains U+002C
- **THEN** that term is excluded from the accepted list
- **AND** the parse result reports one discarded term with the comma reason
- **AND** every other term remains accepted in its original order

#### Scenario: The list is capped at 32 terms

- **WHEN** the file stores 40 accepted terms
- **THEN** only the first 32 are accepted
- **AND** the trailing 8 are discarded from the tail

#### Scenario: A save preserves terms

- **WHEN** the vocabulary store writes parsed options back to the file
- **THEN** the accepted `terms` array is still present
- **AND** `replace` and `protect` are written as before

### Requirement: Terms SHALL be forwarded to the runtime in user order as the decode-time bias

When the active provider declares `vocabularyBias: true` and the accepted term
list is non-empty, the runner SHALL append exactly one `--vocabulary` argument
whose value is the accepted terms joined by `,` in file order. The runner SHALL
NOT sort, reorder, merge entries from `replace` or `protect`, or select only a
subset of the accepted list. Position SHALL be the priority signal: an earlier
term outranks a later one. When the accepted list is empty, no `--vocabulary`
argument SHALL be sent.

#### Scenario: An ordered flag on a supporting provider

- **WHEN** Qwen3 is active and the accepted terms are `Kubernetes`, `GPT-4o`, `张三`
- **THEN** the spawned arguments include `--vocabulary` with the value `Kubernetes,GPT-4o,张三`
- **AND** the existing `-q`, `-m`, and audio-path arguments are unchanged

#### Scenario: No terms means no flag

- **WHEN** Qwen3 is active and the accepted term list is empty
- **THEN** no `--vocabulary` argument is passed
- **AND** the invocation is identical to the pre-change invocation

#### Scenario: Replacement entries are not forwarded as terms

- **WHEN** the file defines `replace` entries and no `terms`
- **THEN** no `--vocabulary` argument is passed

### Requirement: ASR capabilities SHALL declare vocabulary bias truthfully

`AsrCapabilities` SHALL include `vocabularyBias: boolean`. The Qwen3 adapter
SHALL declare `true`; the SenseVoice adapter and the deterministic fake SHALL
declare `false`. Model catalog validation SHALL require the field and SHALL
reject an entry that omits it or supplies a non-boolean value rather than
defaulting. `resources/models.json` SHALL declare the bit for every model.
Callers SHALL decide whether to send terms from this capability, not from a
provider id.

#### Scenario: Per-provider declarations

- **WHEN** the Qwen3, SenseVoice, and fake adapters report capabilities
- **THEN** Qwen3 reports `vocabularyBias: true`
- **AND** SenseVoice and the fake report `vocabularyBias: false`

#### Scenario: A catalog entry without the bit fails closed

- **WHEN** a catalog model entry omits `vocabularyBias` or sets it to a non-boolean value
- **THEN** catalog validation rejects the entry
- **AND** no provider is constructed from that entry

#### Scenario: Behavior follows the capability

- **WHEN** the runner decides whether to pass terms
- **THEN** it reads `vocabularyBias` from the active provider
- **AND** it does not map a provider id to a decision

### Requirement: Providers without vocabulary bias SHALL degrade without altering the transcript

When the active provider declares `vocabularyBias: false`, the runner SHALL NOT
pass `--vocabulary`. The transcription SHALL proceed normally and the result
text SHALL be identical to a run with an empty term list. The result SHALL carry
a `ProviderWarning` whose code is `VOCABULARY_UNSUPPORTED` and whose message
names the active provider and states that terms were not applied. The settings
readback SHALL report this limitation when terms are configured. When the
accepted term list is empty, no vocabulary warning SHALL be emitted, even on an
unsupported provider.

#### Scenario: SenseVoice with configured terms

- **WHEN** SenseVoice is active and terms are accepted
- **THEN** no `--vocabulary` argument is passed
- **AND** the transcript is returned normally
- **AND** the result carries a `VOCABULARY_UNSUPPORTED` warning

#### Scenario: Unsupported provider with no terms

- **WHEN** SenseVoice is active and no terms are accepted
- **THEN** no vocabulary warning is emitted

#### Scenario: The fake provider is honest

- **WHEN** the fake provider is active and terms are configured
- **THEN** it returns a normal result with a `VOCABULARY_UNSUPPORTED` warning
- **AND** dictation does not fail because of the vocabulary request

### Requirement: Runtime term-budget truncation SHALL drop from the tail and preserve order

The app SHALL pass at most the 32 accepted terms and SHALL NOT drop or reorder
terms in anticipation of the runtime's prompt budget. When the runtime truncates
from the tail, earlier terms SHALL retain priority and the call SHALL still
succeed. When the runtime emits a truncation notice on stderr that the runner
recognises, the result SHALL carry a `ProviderWarning` with code
`VOCABULARY_TRUNCATED`; when no recognised notice is present, the transcript
SHALL still be delivered unchanged. A truncation SHALL NOT be reported as an
inference failure.

#### Scenario: Tail terms disappear, the transcript survives

- **WHEN** the runtime cuts the term list at its prompt budget and transcribes successfully
- **THEN** the transcript is returned unchanged
- **AND** the earlier terms are the ones that were applied

#### Scenario: A recognised truncation notice surfaces as a warning

- **WHEN** the runtime acknowledges a truncation on stderr in a form the runner recognises
- **THEN** the result carries a `VOCABULARY_TRUNCATED` warning
- **AND** the result is still a success

#### Scenario: No truncation notice

- **WHEN** the runtime truncates without a recognised stderr notice
- **THEN** the transcript is returned as a success
- **AND** no truncation warning is invented

### Requirement: A runtime that rejects the vocabulary flag SHALL be retried once without it

If the runtime process fails because it does not recognise the `--vocabulary`
option, as indicated by its diagnostic output, the runner SHALL retry the same
input exactly once without the flag. The retry SHALL preserve the normal
transcript path and SHALL attach a `VOCABULARY_UNSUPPORTED` warning. A second
failure SHALL be reported through the existing error taxonomy and SHALL NOT
trigger a further retry. The retry SHALL NOT be attempted for failures unrelated
to the flag.

#### Scenario: Unknown option degrades to an unbiased retry

- **WHEN** the CLI exits with a diagnostic that the vocabulary option is unknown
- **THEN** the runner retries once without `--vocabulary`
- **AND** a successful retry returns the transcript with a `VOCABULARY_UNSUPPORTED` warning

#### Scenario: The retry also fails

- **WHEN** the retry without `--vocabulary` also fails
- **THEN** the original error taxonomy applies
- **AND** no third attempt is made

#### Scenario: An unrelated inference failure is not retried

- **WHEN** the runtime fails for a reason unrelated to the vocabulary flag
- **THEN** no vocabulary retry is performed

### Requirement: Terms SHALL NOT rewrite the decoded transcript

Terms SHALL be used only as decode-time hints. The post-processing stage SHALL
NOT receive terms as `replace` entries, `protect` entries, or masks, and no rule
SHALL be added that rewrites decoded text toward a term. If the model returns a
spelling that differs from a configured term, the app SHALL keep the model
output verbatim, subject only to the existing `replace` and `protect` behaviour.
This change SHALL NOT implement pinyin, homophone, fuzzy, or edit-distance
matching; the omission is deliberate because a text-level substitution can
corrupt ordinary prose that collides with a term.

#### Scenario: A misheard term is not force-corrected

- **WHEN** Qwen3 returns `K8s` and `Kubernetes` is a configured term
- **THEN** the transcript remains `K8s`
- **AND** no replacement is synthesized from the term

#### Scenario: Terms do not enter the rule pass

- **WHEN** post-processing runs with terms configured
- **THEN** its vocabulary input contains only the file's `replace` and `protect` entries
- **AND** `applied` never records a term-driven change

#### Scenario: Existing replacements still work independently

- **WHEN** `replace` maps 库贝内特斯 to Kubernetes and terms also contain Kubernetes
- **THEN** the replacement applies under its own rules
- **AND** the term itself adds no second rewrite

### Requirement: Settings and diagnostics SHALL report term counts without term content

The settings surface SHALL read back the vocabulary as 术语 N 条 / 替换 N 条 /
保护 N 条 using the accepted counts, and SHALL show the number of terms discarded
for containing an ASCII comma as a visible reason. When the active provider lacks
vocabulary bias and terms are configured, the surface SHALL state that terms are
not applied. The diagnostics summary SHALL include a term count and SHALL NOT
include term strings, and the diagnostics bundle SHALL continue to exclude the
vocabulary file contents. The `VocabularySummary` IPC shape SHALL carry counts
and reason counts only, never term content.

#### Scenario: Loaded counts

- **WHEN** the file contains 3 accepted terms, 2 replacements, and 1 protected term
- **THEN** the settings row reports 术语 3 条 / 替换 2 条 / 保护 1 条

#### Scenario: A discarded comma term is explained

- **WHEN** 2 terms were dropped for containing an ASCII comma
- **THEN** the surface shows that 2 terms were ignored and why
- **AND** the term strings themselves are not shown

#### Scenario: Unsupported provider readback

- **WHEN** SenseVoice is active and terms are configured
- **THEN** the settings surface states that the active provider does not use terms
- **AND** the report is derived from the capability bit

#### Scenario: Diagnostics carry counts only

- **WHEN** the diagnostics summary is produced with terms configured
- **THEN** it contains the term count
- **AND** it contains no term strings and no vocabulary file contents
