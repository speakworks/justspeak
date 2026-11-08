/**
 * Pure reading of `codesign --verify --verbose` output.
 *
 * The update decision (OpenSpec `app-update`: unsigned builds state honestly
 * that auto-update needs the signed build) depends on whether the running
 * bundle carries a Developer ID certificate. Parsing stays here so the rule
 * is testable; main runs the actual `codesign` process.
 */

/**
 * True when the codesign output names a non-adhoc authority.
 *
 * A Developer ID signature reports `Authority=Developer ID Application: ...`
 * lines; ad-hoc or missing signatures report nothing usable, and a later
 * explicit `Authority=(unavailable)`/`Signature=adhoc` line can also appear.
 * Anything with the literal "Developer ID" is a distribution signature.
 */
export function isDeveloperIdSigned(codesignOutput: string): boolean {
  return codesignOutput.includes('Developer ID')
}
