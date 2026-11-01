## ADDED Requirements

### Requirement: First run SHALL explain the hotkey, destinations and permissions

The first launch for a given user data directory SHALL show one screen that names the
current dictation hotkey, explains the three delivery destinations (the app's own input,
paste into an editable frontmost app, and the copy panel), and lists the microphone and
Accessibility permissions with plain-language reasons. The screen SHALL offer one action
that dismisses it and SHALL persist that choice for later launches in the same user data.

#### Scenario: A fresh install opens the guide

- **WHEN** the app starts with no stored onboarding choice
- **THEN** the guide is visible with the hotkey, destinations and both permissions

#### Scenario: Dismissing the guide

- **WHEN** the user activates "开始使用"
- **THEN** the guide closes
- **AND** a later launch on the same user data does not show it again

#### Scenario: Broken local storage

- **WHEN** the stored choice cannot be read
- **THEN** the app opens normally instead of trapping the user behind the guide

### Requirement: Permission status SHALL be readable without prompting

The guide SHALL read Accessibility and microphone status without triggering a system
prompt, SHALL explain that the microphone prompt appears on the first recording, and
SHALL explain that Accessibility is what enables automatic paste. It SHALL offer a
control that opens System Settings at the Accessibility pane and SHALL refresh the
status when the window regains focus.

#### Scenario: Accessibility is granted

- **WHEN** the status read returns trusted Accessibility
- **THEN** the guide marks it granted and describes automatic paste as available

#### Scenario: Accessibility is missing

- **WHEN** the status read returns untrusted Accessibility
- **THEN** the guide marks it as needing action and explains the copy-panel fallback
- **AND** the user can open the Accessibility pane

#### Scenario: Returning from System Settings

- **WHEN** the app window regains focus after the user changed a permission
- **THEN** the guide re-reads the status and updates both permission rows

#### Scenario: Microphone has not been requested yet

- **WHEN** microphone status is `not-determined`
- **THEN** the guide explains that macOS will ask on the first recording
- **AND** it does not prompt from the guide itself
