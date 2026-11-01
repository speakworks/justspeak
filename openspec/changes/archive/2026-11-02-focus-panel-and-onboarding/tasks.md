## 1. Focus decision (pure, test-first)

- [x] 1.1 Tests: editable roles require both an editable role and AXSelectedTextRange; AXGroup/AXWebArea are non-editable even with a range; unreadable is unknown
- [x] 1.2 `src/core/focus/editability.ts` parser + classifier
- [x] 1.3 Delivery tests: insert / paste / panel / probe-rejection routing
- [x] 1.4 `deliverTranscript` gains a focus probe and a panel sink

## 2. Probe adapter

- [x] 2.1 `src/main/focus-probe.ts` runs System Events with a 3 s timeout
- [x] 2.2 Probe failure logs and returns `unknown`
- [x] 2.3 Tests inject the exec and cover editable, non-editable, process failure, unreadable script

## 3. Copy panel

- [x] 3.1 Non-activating panel window at the pill position, retained text + theme
- [x] 3.2 Escape registered only while visible; copy writes the clipboard and hides
- [x] 3.3 `?panel=1` renderer: text, copy, close; no editing
- [x] 3.4 New recording hides the panel; main window close destroys it
- [x] 3.5 History outcome `panel`

## 4. First-run guide

- [x] 4.1 Permission IPC: read Accessibility/microphone without prompting, open the Accessibility pane
- [x] 4.2 One-screen guide: hotkey, destinations, permissions, re-check on focus
- [x] 4.3 Completion persists per userData; broken storage fails open
- [x] 4.4 Permission wording covered by unit tests

## 5. Verification

- [x] 5.1 `pnpm typecheck`, `pnpm test`, `pnpm build`, `openspec validate --specs --strict`
- [x] 5.2 E2E: panel path (probe unknown), clipboard copy, panel hides, history outcome `panel`
- [x] 5.3 E2E: first-run screen dismisses once and stays dismissed across restart
- [x] 5.4 E2E: paste path still works with an editable probe answer; shell suite green
- [x] 5.5 Real-device probe: TextEdit/CotEditor/VS Code/Chrome input readable as editable; Finder desktop and Chrome page surface non-editable; real app shows the panel on Finder
