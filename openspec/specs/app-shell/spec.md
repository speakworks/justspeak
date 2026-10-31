# app-shell Specification

## Purpose
TBD - created by archiving change app-shell. Update Purpose after archive.

## Requirements

### Requirement: The main window SHALL present a sidebar of destinations

The window SHALL show a persistent sidebar listing 首页, 历史记录 and 词典, SHALL
mark the current destination, and SHALL offer a settings entry at the bottom of
the sidebar, next to the model the app is running. Each destination SHALL be
named by a page header carrying its title and a one-line description; that header
SHALL also carry the provider picker on every destination except settings. The
window SHALL NOT keep a record button or a transcript card.

#### Scenario: Switching destinations

- **WHEN** the user selects 历史记录 or 词典
- **THEN** the content area shows that destination, the sidebar marks it, and the
  page header names it
- **AND** the settings entry remains available from the sidebar

#### Scenario: Opening settings

- **WHEN** the user activates the sidebar's settings entry
- **THEN** the appearance, hotkey and model settings are shown, named by the page
  header
- **AND** the header offers the only control that returns to 首页
- **AND** the vocabulary editor is not part of that view

### Requirement: Dictation SHALL land in an editable input

首页 SHALL contain exactly one editable input as its working surface. A dictated
transcript SHALL be inserted into that input at the caret and SHALL remain
editable afterwards. The input's value and caret SHALL live above the destination
switch, so a transcript that arrives while another destination is shown is still
inserted. The session state SHALL be shown as one quiet footer line inside that
input's card — a dot, its label, and the current hotkey — and a failed session
SHALL show its message inside the same card, below the input. The window SHALL
NOT show a record button, a transcript card or a banner.

#### Scenario: Dictating on the home destination

- **WHEN** a transcript arrives while 首页 is shown and the input holds the caret
- **THEN** its text is inserted at the caret exactly once
- **AND** the input stays editable

#### Scenario: Text arrives while another destination is shown

- **WHEN** the app's main window is focused and a transcript arrives while 历史记录 or 词典 is shown
- **THEN** the text is inserted into the home input
- **AND** it is present when the user returns to 首页

#### Scenario: A session fails

- **WHEN** the session enters `error`
- **THEN** the message is shown inside the input's card, below the input
- **AND** no transcript is inserted

#### Scenario: No pipeline chrome

- **WHEN** 首页 is shown in any session state
- **THEN** the window contains no record/stop button and no transcript card
- **AND** recording state is conveyed by the input's border, the footer dot and
  the global indicator

### Requirement: Destination switches SHALL NOT interrupt a recording

Moving between destinations SHALL keep the capture controller, session state and
the text already in the input.

#### Scenario: Switching mid-recording

- **WHEN** the user switches destination while recording
- **THEN** the recording continues
- **AND** the text already in the input is still there on return
