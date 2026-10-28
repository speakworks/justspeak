/** One user-defined correction: every `from` spelling becomes `to`. */
export interface VocabularyReplacement {
  from: string
  to: string
}

/**
 * A local word list. `protect` entries are masked before any rule runs, so no
 * normalisation, filler, correction, or repetition rule can edit them.
 */
export interface Vocabulary {
  replace: VocabularyReplacement[]
  protect: string[]
}

/** Rule ids are stable because they travel on the transcript event. */
export type PostprocessRule =
  | 'vocabulary'
  | 'normalize'
  | 'self-correction'
  | 'filler'
  | 'repetition'
  | 'casing'

export const POSTPROCESS_RULES: readonly PostprocessRule[] = [
  'vocabulary',
  'normalize',
  'self-correction',
  'filler',
  'repetition',
  'casing'
]

export type RuleSwitches = Partial<Record<PostprocessRule, boolean>>

export interface PostprocessOptions {
  vocabulary?: Partial<Vocabulary>
  /** An omitted rule is on; only an explicit `false` disables it. */
  rules?: RuleSwitches
  /**
   * Shortest Han-character run that collapse removes. Defaults to, and is
   * floored at, 3, so legitimate two-character reduplication survives; Latin
   * word repeats always collapse at 2.
   */
  repetitionThreshold?: number
}

export interface PostprocessResult {
  text: string
  /** Rules that actually changed the text, in execution order. */
  applied: PostprocessRule[]
}
