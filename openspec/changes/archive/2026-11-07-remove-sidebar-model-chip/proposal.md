## Why

The sidebar footer shows a small chip naming the running ASR model next to the
settings entry. The settings panel already reports the same model in its provider
row, where it is also the place the model is switched, so the chip repeats one
fact in a second, lower-contrast place. The owner reviewed the running app and
asked for it to go: the sidebar should only name destinations.

## What Changes

- Remove the provider chip from the sidebar footer, along with its live dot and
  label. The settings entry stays where it is.
- Drop the `providerLabel` / `providerLive` props the shell passed to the sidebar
  for that chip.
- The settings panel's provider row remains the only place the running model is
  named, and it is still the only place it is switched.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `settings-surface`: the sidebar footer no longer reports the live provider; the
  provider row in the settings panel is the only surface that names it.
- `app-shell`: the settings entry sits at the bottom of the sidebar on its own,
  with no model read-out beside it.

## Impact

- `src/renderer/src/Sidebar.tsx`: the footer button and its props.
- `src/renderer/src/App.tsx`: stop passing the provider label and liveness.
- `src/renderer/src/styles.css`: the `.model-chip`, `.model-dot`, and
  `.model-name` rules.
- `openspec/specs/settings-surface/spec.md`,
  `openspec/specs/app-shell/spec.md`: the clauses that required the chip.
