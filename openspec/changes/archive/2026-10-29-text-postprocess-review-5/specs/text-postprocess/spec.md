## Purpose

Defines the deterministic transcript-cleaning stage that runs between the ASR result and the paste call: Unicode and punctuation normalisation, filler and separator-run removal, repetition collapse, self-correction cleanup, sentence-initial casing, and a local personal vocabulary. The stage is pure, offline, and individually configurable.

## MODIFIED Requirements

### Requirement: Normalisation SHALL be conservative

The stage SHALL apply Unicode NFKC, collapse repeated whitespace, trim, remove stray spacing before punctuation, and convert punctuation to the dominant script. It SHALL NOT edit code-like tokens, including backtick spans, URLs, emails, paths, versions, numbers with units, environment variables, CLI flags, code identifiers, and bare multi-word commands such as `pnpm test`, `npm run build`, and `git commit`. A punctuation run of two or more marks, and every ellipsis/leader form (`…`, `‥`, `︙`, `︰`), SHALL be treated as an atomic token: it SHALL NOT be width-converted, split, or otherwise edited, and SHALL survive normalisation exactly as spoken. Stray whitespace before the first mark of a run SHALL be removed.

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

### Requirement: Filler removal SHALL avoid real words

The stage SHALL remove the standalone Chinese fillers `嗯`, `呃`, `啊`, `那个`, and `就是说`, and the English fillers `um`, `uh`, and `er`, when they are set off from surrounding words. It SHALL remove `like` and `you know` only when punctuation or the start/end of the text sets them off. It SHALL NOT delete a filler that is part of a real word or phrase. When a leading filler is removed, the stage SHALL remove the entire adjacent separator run (for example `...`, `?!`, or `……`). When a sentence-final filler is removed, the stage SHALL remove its adjacent separator run, SHALL keep at most the single mark that terminated the preceding sentence or one mark when the filler followed a word, and SHALL retain all text after the consumed run rather than truncating the transcript. A separating space SHALL be inserted when the retained text begins a non-CJK word, digit, or opening quote/bracket, and SHALL NOT be inserted before CJK text or CJK punctuation.

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

#### Scenario: Leading filler with a full stop

- **WHEN** the transcript is `Um. We should go.` or `You know. It is fine.`
- **THEN** the output is `We should go.` or `It is fine.`
- **AND** the result does not start with a dangling separator

#### Scenario: Leading filler with a separator run

- **WHEN** the transcript is `um... hello`, `um.... hello`, or `um?? hello`
- **THEN** the output is `Hello` with no leading punctuation

#### Scenario: Leading filler with a Chinese ellipsis

- **WHEN** the transcript is `嗯……我们走吧。`
- **THEN** the output is `我们走吧。`

#### Scenario: Filler-only run

- **WHEN** the transcript is `um...` or `um?!`
- **THEN** the non-empty guard returns the original text with an empty `applied` list

#### Scenario: Sentence-final filler

- **WHEN** the transcript is `We should go. Um...` or `We go um...`
- **THEN** the output is `We should go.` or `We go.`
- **AND** at most one terminating mark remains

#### Scenario: Tail after a sentence-final filler

- **WHEN** the transcript is `I went um. Then home.` or `I went um. Then home. And more.`
- **THEN** the output is `I went. Then home.` or `I went. Then home. And more.`
- **AND** no following text is dropped

#### Scenario: Protected tail

- **WHEN** the transcript is `We go um...JustSpeak shipped.` and `JustSpeak` is protected
- **THEN** the output is `We go. JustSpeak shipped.`
- **AND** the boundary is decided from the protected term, not the placeholder

#### Scenario: CJK tail

- **WHEN** the transcript is `我们走 um。然后回家。`
- **THEN** the output is `我们走。然后回家。`
- **AND** no space is inserted before the CJK tail

### Requirement: Repetition collapse SHALL be bounded

The stage SHALL collapse an immediately repeated Latin word at two occurrences (`the the` to `the`) and an immediately repeated Han character when the run reaches the configurable Han threshold. The Han threshold SHALL default to 3 and SHALL have a floor of 3: a configured value below 3 SHALL be ignored and the default SHALL apply, and a non-finite value SHALL be ignored and the default SHALL apply. The stage SHALL preserve any two-character Chinese reduplication at the default threshold (`默默`, `冉冉`, `匆匆`, `津津`, `欣欣`, and other productive forms), laughter (`哈哈哈`), grammatical English doubles (`had had`, `that that`), and all punctuation runs; only filler or self-correction removal may consume a punctuation run. The curated keep list SHALL be retained for a future lower floor but is not reachable through configuration today.

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
