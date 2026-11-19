/** One user-defined correction: every `from` spelling becomes `to`. */
export interface VocabularyReplacement {
  from: string
  to: string
}

/**
 * The word list the rule pass consumes. `protect` entries are masked before
 * any rule runs, so no normalisation, filler, or repetition rule can edit
 * them. Decode-time terms are deliberately absent: they are a file-level
 * setting carried on `PostprocessOptions.terms`, never a rule input.
 */
export interface Vocabulary {
  replace: VocabularyReplacement[]
  protect: string[]
}

/**
 * The normalised `terms` array plus the parse-time discards the settings
 * surface may report. Discard counts are numbers only; term content never
 * leaves the parser through this shape.
 */
export interface TermListParse {
  terms: string[]
  /** Entries rejected for containing U+002C, which the CLI uses as a separator. */
  droppedByComma: number
  /** Distinct entries beyond the accepted-entry cap, dropped from the tail. */
  droppedByCap: number
  /**
   * Entries the runtime would reject outright: a C0 control character (NUL
   * makes `spawn` throw) or a control-token delimiter (`<|` / `|>`).
   * Internal only; never counted as a visible reason.
   */
  droppedByInvalid: number
  /** Comma discards only, the one reason the settings surface explains. */
  droppedTermCount: number
}

/** Rule ids are stable because they travel on the transcript event. */
export type PostprocessRule =
  | 'vocabulary'
  | 'normalize'
  | 'filler'
  | 'repetition'
  | 'casing'

export const POSTPROCESS_RULES: readonly PostprocessRule[] = [
  'vocabulary',
  'normalize',
  'filler',
  'repetition',
  'casing'
]

export type RuleSwitches = Partial<Record<PostprocessRule, boolean>>

export interface PostprocessOptions {
  vocabulary?: Partial<Vocabulary>
  /**
   * Decode-time hints forwarded to the ASR runtime. They are a file-level
   * setting beside `vocabulary`, not part of it: no rule reads them, so a
   * misheard term is never force-corrected into the transcript.
   */
  terms?: string[]
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
