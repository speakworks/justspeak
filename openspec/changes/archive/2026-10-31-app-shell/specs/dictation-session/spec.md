## ADDED Requirements

### Requirement: Delivery SHALL target the app's own input when it owns focus

When a transcript is ready, main SHALL paste into the frontmost application
unless the application's own main window has focus. When the app's own window is
focused the transcript SHALL be delivered to the renderer for insertion into the
home input, and no keystroke SHALL be synthesized, so the text lands exactly
once.

#### Scenario: Dictating into another application

- **WHEN** the app's main window is not focused and a transcript is ready
- **THEN** the transcript is pasted into the frontmost application
- **AND** the renderer does not insert it into the home input

#### Scenario: Dictating into the app's own window

- **WHEN** the app's main window is focused and a transcript is ready
- **THEN** no paste keystroke is synthesized
- **AND** the transcript is delivered to the renderer, which inserts it once

## MODIFIED Requirements

### Requirement: Clipboard injection SHALL snapshot and restore the clipboard

When the app's own main window does not have focus, the paste strategy SHALL
snapshot the clipboard item list exposed by Electron's Clipboard API before
writing the transcript, SHALL attempt the paste once, and SHALL restore the
snapshot only when the clipboard still contains the transcript it wrote. When the
app's own main window has focus, no paste is attempted and the clipboard SHALL be
left untouched. Items the API cannot expose (for example Finder file promises)
are outside this contract.

#### Scenario: Successful paste restores the previous clipboard

- **WHEN** paste succeeds and the clipboard still equals the transcript
- **THEN** the previous clipboard items are restored
- **AND** if full restore fails, the previous plain text is restored when available

#### Scenario: User copy during paste wins

- **WHEN** the clipboard no longer contains the transcript after the paste attempt
- **THEN** the application does not overwrite the user's newer clipboard content

#### Scenario: Paste command failure preserves the transcript

- **WHEN** the paste keystroke fails (for example Accessibility is denied)
- **THEN** the session reports an actionable permission message
- **AND** the transcript remains on the clipboard for manual pasting

#### Scenario: Empty previous clipboard

- **WHEN** the clipboard was empty before injection and the transcript is still present afterward
- **THEN** the clipboard is cleared back to empty rather than leaving the transcript behind

#### Scenario: The app's own window has focus

- **WHEN** the transcript is ready while the app's own main window is focused
- **THEN** no paste is attempted and the clipboard is unchanged
- **AND** the text is delivered to the renderer for insertion

### Requirement: Post-processing SHALL run between the ASR result and delivery

After a successful provider result and before emitting the transcript and delivering it, the session SHALL pass the provider text through the configured post-processing stage, so the fake and local providers share one cleanup path. The transcript event SHALL carry the applied rule ids. If the stage returns empty text for a non-empty ASR result, the session SHALL deliver the raw text instead. A failed provider result SHALL NOT run the stage and SHALL NOT emit a transcript or deliver text.

#### Scenario: Fake provider is cleaned

- **WHEN** the fake provider returns `嗯，你好` and the stage removes the filler
- **THEN** the transcript event and the pasted text both contain the cleaned text

#### Scenario: Local provider is cleaned

- **WHEN** a Qwen3 result succeeds
- **THEN** the same stage runs before the transcript event and paste
- **AND** the event still carries `fake: false` and the measured latency

#### Scenario: Applied rules are recorded

- **WHEN** the stage reports that it changed the text
- **THEN** `TranscriptEvent.applied` lists those rule ids in execution order

#### Scenario: Empty stage output

- **WHEN** an injected stage returns empty text for a non-empty ASR result
- **THEN** the session emits and pastes the raw ASR text
- **AND** `applied` is empty

#### Scenario: Provider failure

- **WHEN** the provider returns a typed error after the bounded retry policy
- **THEN** the stage does not run, no transcript is emitted, and nothing is pasted

### Requirement: Segmented dictation SHALL default to `auto` and keep partial failures visible

The session SHALL keep the single-shot provider path for any utterance that fits the selected provider's limit, and SHALL segment only utterances beyond it. Segmentation SHALL additionally be forceable on or off through explicit configuration, SHALL preserve the existing state machine, delivery policy, provider contract, and 120-second audio bound, and SHALL make a partially failed segmented result visible to the user while still delivering the successful text.

#### Scenario: Default session is unchanged

- **WHEN** segmentation is not configured
- **THEN** the session moves through `idle → recording → transcribing → pasting → idle` exactly as before
- **AND** it calls the provider once with the complete captured audio

#### Scenario: Segmented session delivers ordered text

- **WHEN** segmentation is configured and every segment succeeds
- **THEN** the session emits one transcript event whose text is the concatenation of segment text in utterance order
- **AND** it delivers that text once through the focus-aware delivery step and returns to idle

#### Scenario: Partial segment failure is visible

- **WHEN** at least one segment succeeds and at least one fails
- **THEN** the session delivers the successful text through the same step
- **AND** the following idle state carries a message naming the failed segment index and its error
- **AND** the failed audio is not silently presented as transcribed

#### Scenario: Empty segmented capture

- **WHEN** segmentation finds no speech in the captured audio
- **THEN** the session emits an empty transcript and does not call the provider
- **AND** it returns to idle rather than hanging in transcribing

## RENAMED Requirements

- FROM: `### Requirement: Post-processing SHALL run between the ASR result and paste`
- TO: `### Requirement: Post-processing SHALL run between the ASR result and delivery`
