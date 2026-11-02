## ADDED Requirements

### Requirement: Packaged builds SHALL resolve a bundled runtime

A packaged build SHALL ship the pinned transcribe.cpp CLI and its dylibs inside
the application bundle, under `Contents/Resources/runtime/`, and SHALL resolve
that directory from `process.resourcesPath` instead of the repository `models/`
tree. Model weights SHALL continue to live under `userData/models` and SHALL NOT
be bundled.

#### Scenario: Packaged runtime resolution

- **WHEN** the application runs with `app.isPackaged` true
- **THEN** the CLI path is `<process.resourcesPath>/runtime/transcribe-cli`
- **AND** the model path is still under `<userData>/models`
- **AND** `JUSTSPEAK_TRANSCRIBE_CLI` still overrides the CLI path when set

#### Scenario: Development checkout resolution

- **WHEN** the application runs from a checkout (`app.isPackaged` false)
- **THEN** the CLI path remains the catalog `buildDir` under the repository
  `models/` tree
- **AND** the packaged layout is not consulted

#### Scenario: Packaged runtime is relocatable

- **WHEN** the runtime directory is staged for packing
- **THEN** every dependency of the CLI and the dylibs is either a system library
  or an `@rpath/<name>` entry that exists in the staged directory
- **AND** no `LC_RPATH` entry points at an absolute path outside the system
  library directories
- **AND** each staged binary carries a valid code signature after rewriting

#### Scenario: Missing packaged runtime

- **WHEN** a packaged build cannot find its runtime
- **THEN** the failure message tells the user to reinstall the app or point
  `JUSTSPEAK_TRANSCRIBE_CLI` at a relocatable CLI
- **AND** it does not suggest `pnpm setup:asr`, which cannot repair an installed
  app
