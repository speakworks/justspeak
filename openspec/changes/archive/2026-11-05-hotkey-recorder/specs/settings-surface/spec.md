## MODIFIED Requirements

### Requirement: Validation SHALL report inline

An invalid or refused hotkey chord and an unreadable vocabulary file SHALL
report inside the surface that owns them — the settings surface for the hotkey,
the 词典 destination for the vocabulary — without a modal dialog. An invalid
chord SHALL keep the recorder armed, write nothing, and name the reason; a
refused binding SHALL name the fallback that is live. Reloading SHALL re-read
the vocabulary file and refresh the post-processing stage from the same result.

#### Scenario: Invalid hotkey

- **WHEN** the user records a chord without a modifier, an unsupported key, or a macOS-reserved combination
- **THEN** the recorder shows the reason inline and keeps waiting for another chord
- **AND** no binding is written
