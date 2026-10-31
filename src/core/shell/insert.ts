/**
 * Insert a dictated transcript into the home input.
 *
 * Pure so the caret rules can be tested without a DOM: dictation appends where
 * the user was working, and replacing the whole box would throw away whatever
 * they had typed.
 */

export interface InputSelection {
  value: string
  start: number
  end: number
}

export interface InsertResult {
  value: string
  /** Where the caret belongs after the insert. */
  caret: number
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

export function insertAtSelection(selection: InputSelection, text: string): InsertResult {
  const { value } = selection
  const start = clamp(selection.start, 0, value.length)
  const end = clamp(selection.end, start, value.length)
  if (text.length === 0) return { value, caret: start }
  return {
    value: value.slice(0, start) + text + value.slice(end),
    caret: start + text.length
  }
}
