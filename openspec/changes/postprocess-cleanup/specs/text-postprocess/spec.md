## MODIFIED Requirements

### Requirement: Normalisation SHALL be conservative

The stage SHALL apply Unicode NFKC, collapse repeated whitespace, trim, remove stray spacing before punctuation, and convert punctuation to the dominant script. It SHALL NOT edit code-like tokens, including backtick spans, URLs, emails, paths, versions, numbers with units, environment variables, CLI flags, code identifiers, and bare multi-word commands such as `pnpm test`, `npm run build`, and `git commit`. A punctuation run of two or more marks, and every ellipsis/leader form (`…`, `‥`, `︙`, `︰`), SHALL be treated as an atomic token: it SHALL NOT be width-converted, split, or otherwise edited, and SHALL survive normalisation exactly as spoken. The run set SHALL include the full-width full stop `．` (U+FF0E), so a run of two or more full-width dots is preserved rather than split by NFKC, and SHALL remain a separator run for filler removal. Stray whitespace before the first mark of a run SHALL be removed. Dominant-script detection SHALL ignore every masked span as a neutral boundary, so a protected term or a code-like token cannot change the punctuation branch of the surrounding prose.

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

- **WHEN** the transcript contains `pnpm test`, `npm run build`, `git commit`, `v1.2.3`, `foo_bar`, `1.5`, an email, a URL, or a path
- **THEN** the token is returned byte-for-byte
- **AND** surrounding prose punctuation is still normalised

#### Scenario: Command after a leading filler

- **WHEN** the transcript is `um, pnpm test`
- **THEN** the output is `pnpm test`
- **AND** the command is not capitalised

#### Scenario: Ellipsis run

- **WHEN** the transcript is `他说……`, `他说...`, `他说…`, or `等一下……`
- **THEN** the text is unchanged
- **AND** no `。.` or other split run appears

#### Scenario: Full-width dot run

- **WHEN** the transcript is `他说．．` or `他说．．然后走了`
- **THEN** the text is unchanged
- **AND** no `。.` appears

#### Scenario: Full-width dot run as a filler separator

- **WHEN** the transcript is `um．．然后`, `嗯．．我们走`, or `um．．`
- **THEN** the filler and the adjacent run are removed, yielding `然后` or `我们走`
- **AND** a filler-only run returns the original text with no applied rules

#### Scenario: Ellipsis and leader forms

- **WHEN** the transcript is `他说‥然后走了`, `他说︙然后走了`, or `等一下︰`
- **THEN** the text is unchanged
- **AND** no `。.` or `。..` appears

#### Scenario: Mixed punctuation run

- **WHEN** the transcript is `真的吗?!`
- **THEN** the run is unchanged and is not width-converted

#### Scenario: Stray spacing before a run

- **WHEN** the transcript is `hello ... there`
- **THEN** the output is `hello... there`

#### Scenario: Masked text does not change the dominant script

- **WHEN** `JustSpeak` is protected and the transcript is `他，JustSpeak行。`
- **THEN** the output is `他，JustSpeak行。`
- **AND** the mask placeholder's Latin characters do not flip the sentence to the Latin punctuation branch

### Requirement: Repetition collapse SHALL be bounded

The stage SHALL collapse an immediately repeated Latin word at two occurrences (`the the` to `the`) and an immediately repeated Han character when the run reaches the configurable Han threshold. The Han threshold SHALL default to 3 and SHALL have a floor of 3: a configured value below 3 SHALL be ignored and the default SHALL apply, and a non-finite value SHALL be ignored and the default SHALL apply. The stage SHALL preserve any two-character Chinese reduplication at the default threshold (`默默`, `冉冉`, `匆匆`, `津津`, `欣欣`, and other productive forms), laughter (`哈哈哈`), grammatical English doubles (`had had`, `that that`), and all punctuation runs; only filler removal may consume a punctuation run. The curated keep list SHALL be retained for a future lower floor but is not reachable through configuration today.

#### Scenario: Stutter

- **WHEN** the transcript is `我我我觉得可以。`
- **THEN** the output is `我觉得可以。`

#### Scenario: Legitimate reduplication

- **WHEN** the transcript is `谢谢你的帮助。`, `妈妈来了。`, `默默无闻`, `冉冉升起`, `匆匆忙忙`, `津津有味`, or `欣欣向荣`
- **THEN** the text is unchanged

#### Scenario: Latin repeat at two

- **WHEN** the transcript is `the the plan`
- **THEN** the output is `the plan`
- **AND** the Han threshold does not affect it

#### Scenario: Configurable threshold

- **WHEN** `repetitionThreshold` is 3
- **THEN** `我我走了。` is unchanged and `我我我走了。` becomes `我走了。`

#### Scenario: Lowered threshold guard

- **WHEN** `repetitionThreshold` is 2
- **THEN** it is raised to the floor of 3
- **AND** `我我走了。` is unchanged and `我我我走了。` becomes `我走了。`

#### Scenario: Non-finite threshold

- **WHEN** `repetitionThreshold` is `NaN` or `Infinity`
- **THEN** the default floor of 3 applies
- **AND** `我我走了。` is unchanged and `我我我走了。` becomes `我走了。`

#### Scenario: Punctuation runs survive repetition

- **WHEN** the transcript is `hello!!`, `真的。。`, or `他说……`
- **THEN** the punctuation run is unchanged

### Requirement: Every rule SHALL be individually disableable

`vocabulary`, `normalize`, `filler`, `repetition`, and `casing` SHALL each be disableable through `rules`, and an omitted rule SHALL be enabled. Protection SHALL remain active even when `vocabulary` is disabled because it only prevents edits.

#### Scenario: One rule off

- **WHEN** `rules.filler` is false
- **THEN** `嗯，我觉得可以。` is unchanged

#### Scenario: Vocabulary off, protection on

- **WHEN** `rules.vocabulary` is false and `protect` contains a token
- **THEN** replacements do not run and the protected token is still untouched

#### Scenario: Casing off

- **WHEN** `rules.casing` is false and a leading filler is removed
- **THEN** the remaining text keeps its original first-letter case

## REMOVED Requirements

### Requirement: Self-corrections SHALL drop the abandoned fragment

**Reason**: The heuristic cannot distinguish reported speech, ellipses, negation, and quotation; `他说……不对，走了` was mangled by scanning an ellipsis run as several separators. The owner decided to remove the rule rather than add more exceptions. LLM-based correction is researched separately in `docs/ASR-CORRECTION-RESEARCH.md`.

**Migration**: Text containing `不对`, `我是说`, `no wait`, or `I mean` now passes through `postprocess` unchanged. There is no replacement configuration switch; a future LLM correction stage is opt-in and separate.
