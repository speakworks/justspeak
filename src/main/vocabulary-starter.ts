import raw from '../../resources/vocabulary-starter.json'
import { parseTermList } from '../core/postprocess'

/**
 * The starter list is a read-only resource, imported at build time so the
 * repository file and the packaged app share one source of truth. Terms pass
 * through the existing parser, so a future edit that introduces a comma or a
 * control character is discarded exactly as it would be on a save. The starter
 * is never written on first run: it only feeds an explicit load action.
 */
export const STARTER_VOCABULARY_TERMS: readonly string[] = parseTermList(raw.terms).terms
