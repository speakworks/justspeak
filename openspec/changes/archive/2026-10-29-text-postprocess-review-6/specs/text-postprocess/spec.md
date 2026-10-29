## Purpose

Defines the deterministic transcript-cleaning stage that runs between the ASR result and the paste call: Unicode and punctuation normalisation, filler and separator-run removal, repetition collapse, self-correction cleanup, sentence-initial casing, and a local personal vocabulary. The stage is pure, offline, and individually configurable.

## MODIFIED Requirements

### Requirement: Filler removal SHALL avoid real words

The stage SHALL remove the standalone Chinese fillers `嗯`, `呃`, `啊`, `那个`, and `就是说`, and the English fillers `um`, `uh`, and `er`, when they are set off from surrounding words. It SHALL remove `like` and `you know` only when punctuation or the start/end of the text sets them off. It SHALL NOT delete a filler that is part of a real word or phrase. When a leading filler is removed, the stage SHALL remove the entire adjacent separator run (for example `...`, `?!`, or `……`). When a sentence-final filler is removed, the stage SHALL remove its adjacent separator run, SHALL keep at most the single mark that terminated the preceding sentence or one mark when the filler followed a word, and SHALL retain all text after the consumed run rather than truncating the transcript. A separating space SHALL be inserted when the retained text begins a non-CJK word, digit, or opening quote/bracket, and SHALL NOT be inserted before CJK text or CJK punctuation, nor after CJK sentence punctuation (`。`, `！`, `？`, `…`, `‥`, `︙`, `︰`).

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

#### Scenario: CJK sentence punctuation boundary

- **WHEN** the transcript is `我们走 um。Then home.`
- **THEN** the output is `我们走。Then home.`
- **AND** no space is inserted after the CJK sentence mark

### Requirement: Masking SHALL use disjoint layers and fail closed

The protect, code, and punctuation-run masks SHALL use disjoint sentinel namespaces, and each restore SHALL match only the placeholders that its own mask call emitted, using a call-scoped namespace that is absent from the input. Every later span detector SHALL treat placeholders as opaque and SHALL NOT inspect or split their interiors, regardless of the nonce format. Vocabulary SHALL run only over text between protected and code-like spans, so a replacement SHALL NOT edit a protected token, a code-like token, or a mask placeholder. If any sentinel remains after restoration, the stage SHALL return the original input with an empty `applied` list rather than emit invisible characters.

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

#### Scenario: Placeholders are opaque to span detection

- **WHEN** the transcript is `我们走 um……张三来了。` and `张三` is protected
- **THEN** the output is `我们走…张三来了。`
- **AND** no stray space appears before the protected term
- **AND** the protect placeholder is restored intact

#### Scenario: Protected token beside a punctuation run

- **WHEN** the transcript is `他说……张三来了。` and `张三` is protected
- **THEN** the output is `他说……张三来了。`
- **AND** the run is not split by code detection

#### Scenario: Excluded ranges are opaque

- **WHEN** a code-like string is inside an excluded placeholder range
- **THEN** code detection returns no span that intersects the range
- **AND** removing the exclusion makes the detector report the interior again

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
