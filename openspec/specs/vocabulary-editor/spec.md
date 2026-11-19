# vocabulary-editor Specification

## Purpose
TBD - created by archiving change vocabulary-editor. Update Purpose after archive.

## Requirements

### Requirement: The vocabulary surface SHALL edit all three entry groups

The 词典 destination SHALL provide an editable list for decode-time terms, for
replacement pairs, and for protected words. Each list SHALL support adding an
entry, changing an existing entry, and deleting an entry. The editor SHALL start
from the entries main read from disk, not from a separate renderer store.
Submitting with all three lists empty SHALL be allowed and SHALL write three
empty arrays.

#### Scenario: Editing starts from the file

- **WHEN** `vocabulary.json` contains terms, replacements, and protect entries
- **THEN** the editor shows those accepted entries in their three sections
- **AND** a change is sent only when the user presses save

#### Scenario: Empty save

- **WHEN** the user deletes every entry and saves
- **THEN** `vocabulary.json` is written with empty `terms`, `replace`, and
  `protect` arrays
- **AND** the read-back view reports three zero counts

### Requirement: Batch paste SHALL parse lines deterministically and report line outcomes

The editor SHALL accept a pasted block for each section. Terms and protected
words SHALL be split on lines, trimmed, have blank lines skipped, and be
de-duplicated exactly while keeping the first occurrence. Replacement lines
SHALL be parsed as `from => to`, with both sides trimmed; a line without `=>`
or with an empty side SHALL count as an invalid line and SHALL NOT be dropped
silently. Replacement entries SHALL be de-duplicated by `from`, keeping the
first occurrence. The import result SHALL expose the number of duplicate and
invalid lines to the surface.

#### Scenario: Duplicate and blank lines

- **WHEN** the pasted text is `Kubernetes`, an empty line, and `Kubernetes`
- **THEN** the imported list is `['Kubernetes']`
- **AND** the result reports one duplicate line and no invalid lines

#### Scenario: A malformed replacement line is reported

- **WHEN** the pasted replacement text is `库贝内特斯 => Kubernetes`, `broken`,
  and `=> only-to`
- **THEN** only the first replacement is imported
- **AND** the result reports two invalid lines

#### Scenario: More entries than the decode-time cap

- **WHEN** the user pastes 40 distinct terms
- **THEN** the editor can hold all 40 drafts
- **AND** saving keeps the first 32 accepted terms through the existing parser

### Requirement: The starter list SHALL load only by an explicit, idempotent action

The app SHALL ship a read-only `resources/vocabulary-starter.json` containing
exactly ten starter terms, no ASCII comma in any term, and empty `replace` and
`protect` arrays. This file SHALL be the single source of the starter terms; the
renderer SHALL NOT embed a second copy. Main SHALL read the file and expose the
terms on the vocabulary view. The 词典 surface SHALL offer
`载入起始词表（10 词）` and SHALL write the file only after that explicit click,
never on first run. Loading SHALL keep existing terms first and append only the
missing starter terms in starter order, SHALL reuse the same normalisation,
atomic write, and read-back path as a manual save, and SHALL NOT write when
every starter term is already present; the button SHALL then read
`已全部载入`.

#### Scenario: An empty file after an explicit load

- **WHEN** the file has no terms and the user clicks `载入起始词表（10 词）`
- **THEN** all ten starter terms are written through the normal save path
- **AND** the read-back view reports ten terms

#### Scenario: A partial list

- **WHEN** the file already contains two of the starter terms
- **THEN** only the eight missing terms are appended in starter order
- **AND** the existing terms keep their original positions

#### Scenario: Nothing is written when the load is idempotent

- **WHEN** every starter term is already present
- **THEN** the button reads `已全部载入`
- **AND** no write is sent

#### Scenario: First run stays empty

- **WHEN** the app starts with no vocabulary file
- **THEN** no starter term is written automatically
- **AND** decode-time bias stays empty until the user acts

#### Scenario: The renderer does not carry its own list

- **WHEN** the vocabulary view is built
- **THEN** main supplies the starter terms from the resource file
- **AND** the renderer merges that supplied list rather than a literal copy

### Requirement: Saving SHALL normalise through the existing parser and write atomically

Main SHALL treat the save payload as untrusted and SHALL re-normalise it with
the same parser used when reading `vocabulary.json`, including the 32-term cap,
comma rejection, invalid-character rejection, and replacement/protect filtering.
The store SHALL write to a same-directory temporary file and rename it over the
target. If writing or renaming fails, the temporary file SHALL be removed, the
original file SHALL remain unchanged, and the error SHALL be reported. A
malformed payload SHALL be rejected without writing.

#### Scenario: Normalisation matches the read path

- **WHEN** the same term, replacement, and protect lists are parsed as a save
  payload and as a file payload
- **THEN** both produce the same post-processing options

#### Scenario: A failed rename keeps the old file

- **WHEN** writing the temporary file succeeds but renaming it over
  `vocabulary.json` fails
- **THEN** the old file content is unchanged
- **AND** no temporary file remains
- **AND** the save reports an error

### Requirement: A successful save SHALL update the next dictation from the read-back

After a successful write, main SHALL read the file back and SHALL replace the
in-memory options with the read-back options before reporting success. The next
dictation SHALL therefore use the newly saved terms, replacements, and protect
entries. On failure, main SHALL report a reason and SHALL NOT replace the
in-memory options or claim success.

#### Scenario: The next session sees the new terms

- **WHEN** a save writes the term `Kubernetes` and succeeds
- **THEN** the options returned to the main process contain `Kubernetes`
- **AND** a fresh store load also returns `Kubernetes`

#### Scenario: A failed save changes nothing

- **WHEN** the store throws while writing
- **THEN** the result is `ok: false` with a reason
- **AND** the previous options remain in use

### Requirement: The editor SHALL keep the unsupported-provider notice

When the live ASR provider does not support decode-time vocabulary bias and the
term list is not empty, the vocabulary surface SHALL keep showing
`当前 ASR 模型不支持解码期术语偏置，术语未生效。`. Editing the term list SHALL NOT
hide that notice.

#### Scenario: SenseVoice with terms

- **WHEN** SenseVoice is the active provider and the term list has entries
- **THEN** the surface still names the unsupported decode-time bias
- **AND** the terms remain editable

### Requirement: The view SHALL expose editable entries without changing existing copy

The vocabulary summary SHALL carry the accepted `terms`, `replace`, and
`protect` entries in addition to the existing counts and state. An unreadable
file SHALL keep its explicit reason, and the existing default/loaded/override
copy SHALL not regress. A file written before `terms` existed SHALL remain
editable and SHALL save an empty `terms` array when none are added.

#### Scenario: An unreadable file keeps its reason

- **WHEN** `vocabulary.json` is not valid JSON
- **THEN** the view reports the unreadable state with a reason
- **AND** the editor can still save a fresh valid file

#### Scenario: A file without terms

- **WHEN** an old file has `replace` and `protect` but no `terms`
- **THEN** the editor shows an empty term list
- **AND** saving keeps the replacements and protects the user did not change
