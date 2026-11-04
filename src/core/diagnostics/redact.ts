/**
 * Redaction for diagnostics text. The bundle is user-initiated, but it should
 * not carry local usernames or credentials by default.
 */
export interface RedactionPaths {
  homeDir?: string
  userDataDir?: string
}

const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi

export function redactDiagnosticText(text: string, paths: RedactionPaths = {}): string {
  const replacements = [
    [paths.userDataDir, '<userData>'],
    [paths.homeDir, '<home>']
  ].filter((entry): entry is [string, string] => typeof entry[0] === 'string' && entry[0].length > 1)

  // Longer paths first: the userData path usually lives under the home path.
  replacements.sort((left, right) => right[0].length - left[0].length)
  let result = text
  for (const [value, placeholder] of replacements) {
    result = result.split(value).join(placeholder)
  }
  return result.replace(BEARER, 'Bearer <redacted>')
}
