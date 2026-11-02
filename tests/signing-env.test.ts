import { describe, expect, it } from 'vitest'
import { checkSigningEnv } from '../src/core/packaging/signing-env'

const CERT = 'Developer ID Application: JustSpeak (ABCDE12345)'
const APPLE_ID_ENV = {
  CSC_NAME: CERT,
  APPLE_ID: 'owner@example.com',
  APPLE_APP_SPECIFIC_PASSWORD: 'app-specific',
  APPLE_TEAM_ID: 'ABCDE12345'
}

describe('signing environment', () => {
  it('accepts a certificate name plus Apple ID credentials', () => {
    expect(checkSigningEnv(APPLE_ID_ENV)).toEqual({ ok: true })
  })

  it('accepts an App Store Connect API key instead of the Apple ID triple', () => {
    expect(
      checkSigningEnv({
        CSC_NAME: CERT,
        APPLE_API_KEY: '/keys/AuthKey.p8',
        APPLE_API_KEY_ID: 'KEYID12345',
        APPLE_API_ISSUER: 'issuer-uuid'
      })
    ).toEqual({ ok: true })
  })

  it('names every missing variable instead of a generic failure', () => {
    const result = checkSigningEnv({})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missing).toContain('CSC_NAME')
    expect(result.missing.join(' ')).toContain('APPLE_ID')
  })

  it('requires the p12 password when a certificate file is supplied', () => {
    const result = checkSigningEnv({ ...APPLE_ID_ENV, CSC_LINK: 'base64-p12' })
    expect(result).toEqual({ ok: false, missing: ['CSC_KEY_PASSWORD'] })
  })

  it('reports a partial API key triple', () => {
    const result = checkSigningEnv({
      CSC_NAME: CERT,
      APPLE_API_KEY: '/keys/AuthKey.p8',
      APPLE_API_KEY_ID: 'KEYID12345'
    })
    expect(result).toEqual({ ok: false, missing: ['APPLE_API_ISSUER'] })
  })

  it('accepts a complete API key pair even when a stray APPLE_ID is exported', () => {
    expect(
      checkSigningEnv({
        CSC_NAME: CERT,
        APPLE_ID: 'owner@example.com',
        APPLE_API_KEY: '/keys/AuthKey.p8',
        APPLE_API_KEY_ID: 'KEYID12345',
        APPLE_API_ISSUER: 'issuer-uuid'
      })
    ).toEqual({ ok: true })
  })

  it('accepts a notarytool keychain profile', () => {
    expect(
      checkSigningEnv({
        CSC_NAME: CERT,
        APPLE_KEYCHAIN: '/Users/me/Library/Keychains/login.keychain-db',
        APPLE_KEYCHAIN_PROFILE: 'notary-profile'
      })
    ).toEqual({ ok: true })
  })

  it('does not require the keychain path when a profile is set', () => {
    expect(
      checkSigningEnv({ CSC_NAME: CERT, APPLE_KEYCHAIN_PROFILE: 'notary-profile' })
    ).toEqual({ ok: true })
  })
})
