/**
 * Pure reading of `codesign --verify --verbose` output.
 *
 * The update decision (OpenSpec `app-update`: unsigned builds state honestly
 * that auto-update needs the signed build) depends on whether the running
 * bundle carries a Developer ID certificate. Parsing stays here so the rule
 * is testable; main runs the actual `codesign` process (and requires
 * `--verify --strict` to pass before this is consulted).
 */

/**
 * True when `codesign -dv` output names a Developer ID Application authority.
 *
 * Matching the full `Authority=Developer ID Application:` line — not the bare
 * substring — keeps a self-signed certificate whose common name merely
 * contains "Developer ID" from passing as a distribution signature.
 */
export function isDeveloperIdSigned(codesignOutput: string): boolean {
  return /^\s*Authority=Developer ID Application:/m.test(codesignOutput)
}
