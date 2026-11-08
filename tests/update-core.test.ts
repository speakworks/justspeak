import { describe, expect, it } from 'vitest'
import { isDeveloperIdSigned } from '../src/core/update/signature'
import {
  AUTO_CHECK_INTERVAL_MS,
  isUpdateAutoCheckEnabled,
  shouldAutoCheck
} from '../src/core/update/policy'
import { compareVersions, isNewerVersion } from '../src/core/update/version'

describe('version comparison follows semver, not string order', () => {
  it('orders patch, minor and major bumps correctly', () => {
    expect(isNewerVersion('0.1.0', '0.1.1')).toBe(true)
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(true)
    expect(isNewerVersion('0.1.0', '1.0.0')).toBe(true)
    expect(isNewerVersion('0.2.0', '0.1.0')).toBe(false)
    // Numeric, not lexical: '1.10.0' sorts after '1.9.0' as a string, but 10 > 9.
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(false)
  })

  it('treats a prerelease as older than the release of the same core', () => {
    expect(isNewerVersion('0.1.0-demo.0', '0.1.0')).toBe(true)
    expect(isNewerVersion('0.1.0', '0.1.0-demo.0')).toBe(false)
    expect(isNewerVersion('0.1.0-demo.0', '0.2.0')).toBe(true)
  })

  it('orders prerelease identifiers numerically and alphabetically', () => {
    expect(isNewerVersion('0.1.0-demo.2', '0.1.0-demo.10')).toBe(true)
    expect(isNewerVersion('0.1.0-alpha', '0.1.0-beta')).toBe(true)
    expect(isNewerVersion('0.1.0-demo.0', '0.1.0-demo.0.1')).toBe(true)
    expect(isNewerVersion('0.1.0-demo.1', '0.1.0-demo.1')).toBe(false)
  })

  it('never flags the running version itself as newer', () => {
    expect(isNewerVersion('0.1.0-demo.0', '0.1.0-demo.0')).toBe(false)
  })

  it('compares malformed versions without throwing', () => {
    // The feed is external data; a malformed version must not crash a check.
    expect(compareVersions('0.1.0', 'not-a-version')).toBe(-1)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('garbage', 'garbage')).toBe(0)
  })
})

describe('the automatic check runs at most once per day', () => {
  const DAY = AUTO_CHECK_INTERVAL_MS

  it('is disabled by the default preference value', () => {
    expect(isUpdateAutoCheckEnabled(undefined)).toBe(false)
    expect(isUpdateAutoCheckEnabled(false)).toBe(false)
    expect(isUpdateAutoCheckEnabled(true)).toBe(true)
  })

  it('skips entirely while the toggle is off', () => {
    expect(shouldAutoCheck({ enabled: false, lastCheckAtMs: 0, nowMs: 1e15 })).toBe(false)
  })

  it('runs on the first tick after enabling', () => {
    expect(shouldAutoCheck({ enabled: true, lastCheckAtMs: 0, nowMs: 1_000_000 })).toBe(true)
  })

  it('holds back inside the 24h window and releases after it', () => {
    const lastCheck = 5_000_000_000
    expect(shouldAutoCheck({ enabled: true, lastCheckAtMs: lastCheck, nowMs: lastCheck + DAY - 1 })).toBe(false)
    expect(shouldAutoCheck({ enabled: true, lastCheckAtMs: lastCheck, nowMs: lastCheck + DAY })).toBe(true)
  })

  it('treats a clock moving backwards as due rather than waiting a full interval', () => {
    // A restored backup or manual clock change must not silence the check for
    // a day; rechecking is harmless and once-per-day is a politeness rule.
    expect(shouldAutoCheck({ enabled: true, lastCheckAtMs: 5_000_000, nowMs: 4_000_000 })).toBe(true)
  })
})

describe('signature detection reads codesign output', () => {
  it('recognises a Developer ID authority as a distribution signature', () => {
    expect(
      isDeveloperIdSigned(
        'Authority=Developer ID Application: Example Ltd (TEAMID)\nAuthority=Developer ID Certification Authority\nSignature=adhoc from the future'
      )
    ).toBe(true)
  })

  it('does not mistake ad-hoc or missing signatures for distribution ones', () => {
    expect(isDeveloperIdSigned('code object is not signed at all')).toBe(false)
    expect(isDeveloperIdSigned('Authority=(unavailable)\nSignature=adhoc')).toBe(false)
    expect(isDeveloperIdSigned('')).toBe(false)
  })
})
