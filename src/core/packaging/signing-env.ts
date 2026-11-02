/**
 * What a signed, notarised macOS build needs from the release environment.
 *
 * The check is pure so the release script can fail with the same message a
 * unit test sees, and so provisioning mistakes surface before electron-builder
 * spends minutes building an app it cannot sign.
 */

export interface SigningEnv {
  /** `Developer ID Application: <Team Name> (<TEAMID>)`. */
  CSC_NAME?: string
  /** Base64 `.p12` for CI; optional when the certificate is in the keychain. */
  CSC_LINK?: string
  CSC_KEY_PASSWORD?: string
  APPLE_ID?: string
  APPLE_APP_SPECIFIC_PASSWORD?: string
  APPLE_TEAM_ID?: string
  APPLE_API_KEY?: string
  APPLE_API_KEY_ID?: string
  APPLE_API_ISSUER?: string
  /** A `notarytool` keychain profile; the keychain path is optional. */
  APPLE_KEYCHAIN?: string
  APPLE_KEYCHAIN_PROFILE?: string
}

export type SigningEnvCheck = { ok: true } | { ok: false; missing: string[] }

interface CredentialPair {
  variables: string[]
  /** What to report when no pair is complete and none was started. */
  label: string
}

const NOTARIZATION_PAIRS: CredentialPair[] = [
  {
    variables: ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
    label: 'APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID'
  },
  {
    variables: ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
    label: 'APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER'
  },
  {
    // electron-builder only requires the profile; the keychain path defaults to
    // the login keychain.
    variables: ['APPLE_KEYCHAIN_PROFILE'],
    label: 'APPLE_KEYCHAIN_PROFILE'
  }
]

function present(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Notarisation accepts a complete credential pair: the Apple ID triple, the
 * App Store Connect API key triple, or a notarytool keychain profile. A stray
 * variable from another pair (a CI image often exports `APPLE_ID` for unrelated
 * tooling) must not turn a complete pair into a failure.
 */
export function checkSigningEnv(env: SigningEnv): SigningEnvCheck {
  const missing: string[] = []

  if (!present(env.CSC_NAME)) missing.push('CSC_NAME')
  if (present(env.CSC_LINK) && !present(env.CSC_KEY_PASSWORD)) {
    missing.push('CSC_KEY_PASSWORD')
  }

  const pairs = NOTARIZATION_PAIRS.map((pair) => {
    const values = pair.variables.map((variable) =>
      present(env[variable as keyof SigningEnv] as string | undefined)
    )
    return {
      ...pair,
      complete: values.every(Boolean),
      started: values.some(Boolean),
      absent: pair.variables.filter((_, index) => !values[index])
    }
  })

  if (!pairs.some((pair) => pair.complete)) {
    const started = pairs.find((pair) => pair.started)
    if (started) missing.push(...started.absent)
    else missing.push(NOTARIZATION_PAIRS.map((pair) => pair.label).join(' 或 '))
  }

  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}
