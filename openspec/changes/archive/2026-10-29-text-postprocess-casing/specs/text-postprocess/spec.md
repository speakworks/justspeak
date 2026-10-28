## Purpose

Defines the deterministic transcript-cleaning stage that runs between the ASR result and the paste call: Unicode and punctuation normalisation, filler removal, repetition collapse, self-correction cleanup, sentence-initial casing, and a local personal vocabulary. The stage is pure, offline, and individually configurable.

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Sentence-initial casing SHALL be restored after a leading drop

The stage SHALL uppercase the first Latin letter of the result when the preceding rules remove
the sentence's original first word, so the sentence still begins with a capital. It SHALL NOT
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

#### Scenario: Mid-sentence filler

- **WHEN** the transcript is `I think, um, we should ship it.` or `We test, um, we ship.`
- **THEN** the output is `I think we should ship it.` or `We test we ship.`
- **AND** no word after the first letter is capitalised or lowercased

#### Scenario: Protected token

- **WHEN** the transcript is `you know, iPhone is good.` and `iPhone` is protected
- **THEN** the output is `iPhone is good.`
- **AND** the token's case is unchanged

#### Scenario: Code-like start

- **WHEN** the transcript starts with `` `foo` `` or a URL
- **THEN** the masked token is unchanged and casing does not fire inside it

#### Scenario: Chinese text

- **WHEN** the transcript is `嗯，我们开始吧。`
- **THEN** the output is `我们开始吧。`
- **AND** `applied` does not contain `casing`

#### Scenario: Safety guard

- **WHEN** the transcript is only `um`
- **THEN** the output is the original `um`
- **AND** `applied` is empty
