## Context

The delivery contract was binary: focused own window → insert, otherwise paste.
macOS Accessibility can report the frontmost element's role and whether it
supports a text selection range, which is enough to decide whether a paste has a
destination. The probe was run against the apps the owner uses:

| App / context | Role | AXSelectedTextRange | Decision |
|---|---|---|---|
| TextEdit document | `AXTextArea` | yes | editable |
| CotEditor | `AXTextArea` | yes | editable |
| VS Code editor | `AXTextArea` | yes | editable |
| Chrome page surface | `AXWebArea` | yes (empty) | non-editable |
| Chrome focused input | `AXTextField` | yes | editable |
| Finder desktop / list | `AXGroup` / `AXOutline` | yes/empty | non-editable |
| unreadable / probe error | — | — | unknown |

A range alone is not enough: Finder and Chrome both advertise one. The role is
decisive.

## Decisions

| Question | Decision | Why |
|---|---|---|
| How to read the element | `osascript` + System Events, 10 s timeout (same as paste) | Same Accessibility path as paste; no native module, no new permission. A shorter cap would turn a slow spawn into a silent panel fallback. |
| Unknown result | Copy panel | The card's first frozen decision: never guess a paste. |
| Panel window | Separate `panel` BrowserWindow, `focusable: false`, bottom-centre | The pill already proves this combination floats without stealing focus. |
| Escape | Temporary global shortcut while the panel is visible | A non-focusable window cannot receive the key; unregistered on hide. |
| Theme | Payload carries the resolved theme | The panel renderer never mounts `App`, so it cannot resolve `system` itself. |
| History outcome | Add `panel` | `pasted` would be false; `panel` says the text reached the copy surface. |
| Onboarding completion | `localStorage` per userData | UI-only state; no new preferences schema. |
| Permission reads | `systemPreferences.isTrustedAccessibilityClient(false)` and `getMediaAccessStatus` | Both read without prompting; the screen explains before macOS asks. |

## Panel lifecycle

```
transcript ready
  own window focused -> renderer insert
  else probe focus
    editable -> paste (unchanged clipboard contract)
    non-editable/unknown -> show panel (retained text + theme)
panel copy -> clipboard + hide after 250 ms
panel close / Escape -> hide
new recording -> hide
main window closed -> destroy panel
```

The panel keeps the text in main so the renderer handshake can replay it on a
cold first show. A second transcript replaces the retained text and moves the
panel to the current pointer's display.

## First-run screen

`App` reads one `localStorage` key. The screen fetches permissions on mount and on
window focus (the user returns from System Settings), shows the configured
hotkey, and explains the three delivery destinations. "Start" writes the key.
Broken storage fails open: the screen does not trap the app behind a modal it
cannot dismiss.

## Failure policy

- Probe failure → panel.
- Panel load failure → destroy the window; the next transcript rebuilds it.
- Clipboard write in the panel is the only action; no paste keystroke is ever
  synthesized from this path.
- Permission status read failure is shown inline; the start button still works.
