## Purpose

Defines the deterministic transcript-cleaning stage that runs between the ASR result and the paste call: Unicode and punctuation normalisation, filler removal, repetition collapse, self-correction cleanup, sentence-initial casing, and a local personal vocabulary. The stage is pure, offline, and individually configurable.

## MODIFIED Requirements

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

The stage SHALL remove the standalone Chinese fillers `嗯`, `呃`, `啊`, `那个`, and `就是说`, and the English fillers `um`, `uh`, and `er`, when they are set off from surrounding words. It SHALL remove `like` and `you know` only when punctuation or the start/end of the text sets them off. It SHALL NOT delete a filler that is part of a real word or phrase. When a leading or sentence-final filler carries its own sentence separator, the stage SHALL remove the orphan mark instead of leaving a dangling separator.

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

#### Scenario: Sentence-final filler

- **WHEN** the transcript is `We should go. Um.` or `We go um.`
- **THEN** the output is `We should go.` or `We go.`

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

## ADDED Requirements

### Requirement: Masking SHALL use disjoint layers and fail closed

The protect and code masks SHALL use disjoint sentinel namespaces, and each restore SHALL match
only the placeholders of its own layer. Vocabulary SHALL run only over text between protected
and code-like spans, so a replacement SHALL NOT edit a protected token, a code-like token, or a
mask placeholder. If any sentinel remains after restoration, the stage SHALL return the original
input with an empty `applied` list rather than emit invisible characters.

#### Scenario: Protected token beside a version

- **WHEN** the transcript is `JustSpeak v1.2.3 is out.` and `JustSpeak` is protected
- **THEN** the output is `JustSpeak v1.2.3 is out.`
- **AND** no sentinel character appears in the output

#### Scenario: Protected token beside an email or URL

- **WHEN** the transcript is `Mail JustSpeak at dev@example.com.` or contains a URL with the
  protected token
- **THEN** each literal is returned unchanged

#### Scenario: Numeric replacement

- **WHEN** `1` maps to `一` and `JustSpeak` and `FD2008` are protected in
  `JustSpeak 和 FD2008 都在。`
- **THEN** the output equals the input and `applied` is empty

#### Scenario: Vocabulary cannot edit literals

- **WHEN** `cat` maps to `dog` and the transcript is `` `cat` and cat `` or
  `https://example.com/cat`
- **THEN** the code-like occurrence is unchanged
- **AND** only the editable occurrence changes

#### Scenario: Sentinel leak

- **WHEN** the restored output would still contain a mask sentinel
- **THEN** the original input is returned with `applied: []`

### Requirement: Long input SHALL stay bounded

The stage SHALL process long tokens in time linear in their length and SHALL NOT catastrophically
backtrack on inputs that look like an email local part or a command without a match.

#### Scenario: Long token

- **WHEN** a 60,000-character token is processed
- **THEN** it completes well under one second and returns non-empty text
