## Context

The overlay has two states: `recording` and `working` (transcribing + pasting).
The pill renders `PILL_BARS = 17` spans. The original working form ran the same
level-driven waveform, which claimed live audio after the microphone closed. A
first replacement (Thinking + a 1.6 s progress fill) introduced a new surface
that was frequently cut off by fast local recognition.

The approved design keeps the recording surface and changes only its colour.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Geometry | Keep the 17 bars at the resting `scaleY(0.11)` | The user's reference: the point is the same size as the flat waveform, so no shape/size change. |
| Signal | Colour only: pending `currentColor@0.5`, passed/active accent | Visually distinct from the level-driven waveform without a new surface. |
| Movement | Active bar hops 4 px; one step every 110 ms (90 + 20) | A small, readable step; the hop is on the bar itself, not a separate mover. |
| Completion | Last bar lit | The end of the row is the only completion signal; no text or percentage. |
| Fast delivery | Jump the highlight directly to the last bar | Avoids a mid-walk disappearance; the pill hides ~200 ms later. |
| Slow delivery | Wait on the last bar | Do not loop, reverse, or restart. |
| Reduced motion | Keep the colour walk, disable the 4 px hop | Colour changes remain readable; no vertical motion. |
| Test seam | `JUSTSPEAK_FAKE_DELAY_MS` in fake mode only | The provider otherwise finishes too fast to observe the working state in E2E. |

## Protocol

`sendState('idle')` calls `completeOverlay()` before `hideOverlay()`.
`completeOverlay` only sends `overlay:complete` when the retained overlay state
is `working` and the window is visible, so an idle reached from a cancelled
recording or startup just hides. The renderer moves the walk to the last bar on
that signal; the existing 200 ms hide delay is the completion beat.

## Layout

```
recording:  [✕]  ▁▃▅▂▁▅▃  [✓]   17 level-driven bars
working:          ▁▁▁▁●▁▁▁       17 resting bars, accent walk, no buttons/text
```

The working pill keeps the same 132×38 bounds and the same non-activating panel
window. The bar count is the waveform's own count, so no parallel track exists.
