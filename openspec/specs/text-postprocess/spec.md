# text-postprocess Specification

## Purpose
Defines the deterministic transcript-cleaning stage that runs between the ASR result and the paste call: Unicode and punctuation normalisation, filler and separator-run removal, repetition collapse, self-correction cleanup, sentence-initial casing, and a local personal vocabulary. The stage is pure, offline, and individually configurable.

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

The stage SHALL apply Unicode NFKC, collapse repeated whitespace, trim, remove stray spacing before punctuation, and convert punctuation to the dominant script. It SHALL NOT edit code-like tokens, including backtick spans, URLs, emails, paths, versions, numbers with units, environment variables, CLI flags, code identifiers, and bare multi-word commands such as `pnpm test`, `npm run build`, and `git commit`.

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

### Requirement: Filler removal SHALL avoid real words

The stage SHALL remove the standalone Chinese fillers `嗯`, `呃`, `啊`, `那个`, and `就是说`, and the English fillers `um`, `uh`, and `er`, when they are set off from surrounding words. It SHALL remove `like` and `you know` only when punctuation or the start/end of the text sets them off. It SHALL NOT delete a filler that is part of a real word or phrase. When a filler is leading or sentence-final, the stage SHALL remove the entire adjacent separator run (for example `...`, `?!`, or `……`) together with the filler, not a single mark.

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
- **AND** no duplicate separator run remains

### Requirement: Repetition collapse SHALL be bounded

The stage SHALL collapse an immediately repeated Latin word at two occurrences (`the the` to `the`), an immediately repeated Han character when the run reaches the configurable Han threshold (default 3, so `我我我` becomes `我`), and duplicated identical punctuation. It SHALL preserve any two-character Chinese reduplication at the default threshold (`默默`, `冉冉`, `匆匆`, `津津`, `欣欣`, and other productive forms), laughter (`哈哈哈`), grammatical English doubles (`had had`, `that that`), and a three-dot ellipsis. The curated keep list SHALL apply only when a user lowers the Han threshold to 2.

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

- **WHEN** `repetitionThreshold` is 2 and the transcript is `谢谢`
- **THEN** the text is unchanged because the keep list still guards it

### Requirement: Personal vocabulary SHALL be local and applied first

The stage SHALL read a word list from `userData/vocabulary.json` with `replace` (`from` to `to`) and `protect` entries. Replacement SHALL run before normalisation, longest match first; ASCII entries SHALL match case-insensitively on word boundaries, and CJK entries SHALL match literally. Protected entries SHALL be excluded from replacement and masked before normalisation and the rule pass, so no rule can edit them. A missing, corrupt, or non-object file SHALL resolve to defaults without throwing.

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

The stage SHALL treat `不对`, `我是说`, `no wait`, and `I mean` as correction markers only when punctuation or the start of the text sets them off and replacement content follows. It SHALL delete the clause before the marker through the marker and its entire trailing separator run, SHALL keep earlier clauses, and SHALL treat a run of markers as one correction.

#### Scenario: Chinese correction

- **WHEN** the transcript is `周一发，不对，周二发。`
- **THEN** the output is `周二发。`

#### Scenario: Earlier clause survives

- **WHEN** the transcript is `先做A，然后B，不对，我是说C。`
- **THEN** the output is `先做A，C。`

#### Scenario: Ellipsis after the marker

- **WHEN** the transcript is `No wait... Tuesday.`
- **THEN** the output is `Tuesday.`
- **AND** it does not start with a dangling mark

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

`vocabulary`, `normalize`, `self-correction`, `filler`, `repetition`, and `casing` SHALL each be disableable through `rules`, and an omitted rule SHALL be enabled. Protection SHALL remain active even when `vocabulary` is disabled because it only prevents edits.

#### Scenario: One rule off

- **WHEN** `rules.filler` is false
- **THEN** `嗯，我觉得可以。` is unchanged

#### Scenario: Vocabulary off, protection on

- **WHEN** `rules.vocabulary` is false and `protect` contains a token
- **THEN** replacements do not run and the protected token is still untouched

#### Scenario: Casing off

- **WHEN** `rules.casing` is false and a leading filler is removed
- **THEN** the remaining text keeps its original first-letter case

### Requirement: Plain prose SHALL pass through unchanged

With default options, text that needs no cleanup SHALL be returned exactly as received with no applied rules.

#### Scenario: Clean Chinese and English

- **WHEN** the transcript is `今天天气很好，我们去公园散步。` or `The quick brown fox jumps over the lazy dog.`
- **THEN** the output equals the input and `applied` is empty

### Requirement: Sentence-initial casing SHALL be restored after a leading drop

The stage SHALL uppercase the first Latin letter of the result only when the preceding rules
remove the sentence's original first word, so the sentence still begins with a capital. It
SHALL NOT capitalize text whose first word survived, even if a later word changed. It SHALL NOT
change anything after that first letter, SHALL NOT lowercase existing text, SHALL NOT touch
Chinese or Japanese text, and SHALL NOT uppercase a protected token or the contents of a code
span, URL, or other masked literal. The `casing` rule SHALL be reported in `applied` only when
it changes the text, and the non-empty safety guard SHALL still return the original input when
every rule would empty it.

#### Scenario: Leading English filler

- **WHEN** the transcript is `You know, it is fine.`
- **THEN** the output is `It is fine.`
- **AND** `applied` contains `filler` and `casing`

#### Scenario: Lowercase input at the sentence start

- **WHEN** the transcript is `um, we should go`
- **THEN** the output is `We should go`

#### Scenario: No leading removal

- **WHEN** the transcript is `hello, world`, `her umbrella`, `concatenate the cat`, or `pnpm test`
- **THEN** the first letter is unchanged
- **AND** `applied` does not contain `casing`

#### Scenario: Mid-sentence filler

- **WHEN** the transcript is `I think, um, we should ship it.` or `We test, um, we ship.`
- **THEN** the output is `I think we should ship it.` or `We test we ship.`
- **AND** no word after the first letter is capitalised or lowercased

#### Scenario: Protected token

- **WHEN** the transcript is `you know, iPhone is good.` and `iPhone` is protected
- **THEN** the output is `iPhone is good.`
- **AND** the token's case is unchanged

#### Scenario: Code-like start

- **WHEN** the transcript starts with `` `foo` ``, a URL, or `pnpm test`
- **THEN** the masked token is unchanged and casing does not fire inside it

#### Scenario: Chinese text

- **WHEN** the transcript is `嗯，我们开始吧。`
- **THEN** the output is `我们开始吧。`
- **AND** `applied` does not contain `casing`

#### Scenario: Safety guard

- **WHEN** the transcript is only `um`
- **THEN** the output is the original `um`
- **AND** `applied` is empty

### Requirement: Masking SHALL use disjoint layers and fail closed

The protect and code masks SHALL use disjoint sentinel namespaces, and each restore SHALL match only the placeholders that its own mask call emitted, using a call-scoped namespace that is absent from the input. Vocabulary SHALL run only over text between protected and code-like spans, so a replacement SHALL NOT edit a protected token, a code-like token, or a mask placeholder. If any sentinel remains after restoration, the stage SHALL return the original input with an empty `applied` list rather than emit invisible characters.

#### Scenario: Protected token beside a version

- **WHEN** the transcript is `JustSpeak v1.2.3 is out.` and `JustSpeak` is protected
- **THEN** the output is `JustSpeak v1.2.3 is out.`
- **AND** no sentinel character appears in the output

#### Scenario: Protected token beside an email or URL

- **WHEN** the transcript is `Mail JustSpeak at dev@example.com.` or contains a URL with the protected token
- **THEN** each literal is returned unchanged

#### Scenario: Numeric replacement

- **WHEN** `1` maps to `一`, `JustSpeak` and `FD2008` are protected, and the transcript is `JustSpeak 和 FD2008 都在，第 1 版。`
- **THEN** the protected names survive and the plain `1` becomes `一`
- **AND** `applied` contains `vocabulary`
- **AND** no sentinel character appears in the output

#### Scenario: Vocabulary cannot edit literals

- **WHEN** `cat` maps to `dog` and the transcript is `` `cat` and cat `` or `https://example.com/cat`
- **THEN** the code-like occurrence is unchanged
- **AND** only the editable occurrence changes

#### Scenario: Sentinel-shaped user text

- **WHEN** the transcript contains a sentinel-shaped sequence that no mask call emitted
- **THEN** restore does not rewrite it
- **AND** the fail-closed guard returns the original with `applied: []`

#### Scenario: Sentinel leak

- **WHEN** the restored output would still contain a mask sentinel
- **THEN** the original input is returned with `applied: []`

#### Scenario: Sentinel leak with a rule change

- **WHEN** a filler would change a transcript that still contains a sentinel
- **THEN** the original input is returned with `applied: []`
- **AND** removing the guard makes this scenario fail

### Requirement: Long input SHALL stay bounded

The stage SHALL process long tokens in time linear in their length and SHALL NOT catastrophically backtrack on inputs that look like an email local part or a command without a match.

#### Scenario: Long token

- **WHEN** a 60,000-character token is processed
- **THEN** it completes well under one second and returns non-empty text
