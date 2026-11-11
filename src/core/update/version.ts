/**
 * Pure update-version comparison.
 *
 * electron-updater reports versions like `0.2.0` and the app runs versions
 * like `0.1.0-demo.0` (semver with a prerelease). Comparison must follow
 * semver: a prerelease sorts before the release of the same version, and
 * numeric identifiers compare numerically, not lexically.
 */

/**
 * Semver-style comparison: -1 when `candidate` < `current`, 0 when equal,
 * 1 when `candidate` > `current`.
 *
 * A malformed candidate is never "newer" (the check just reports nothing), and
 * a malformed running version lets any well-formed candidate through — the
 * updater feed is external data, so a malformed version must not crash a
 * check nor strand the user on a stale build.
 */
export function compareVersions(current: string, candidate: string): number {
  const a = parseVersion(current)
  const b = parseVersion(candidate)
  if (!a && !b) return 0
  if (!b) return -1
  if (!a) return 1

  for (let i = 0; i < 3; i += 1) {
    if (b.core[i] !== a.core[i]) return b.core[i] > a.core[i] ? 1 : -1
  }

  // A release (no prerelease) is newer than any prerelease of the same core.
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return -1
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return 1

  for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i += 1) {
    const left = a.prerelease[i]
    const right = b.prerelease[i]
    const lnum = /^\d+$/.test(left)
    const rnum = /^\d+$/.test(right)
    if (lnum && rnum) {
      const diff = Number(right) - Number(left)
      if (diff !== 0) return diff > 0 ? 1 : -1
    } else if (lnum !== rnum) {
      // Semver: numeric identifiers have LOWER precedence than alphanumeric
      // ones. A numeric `left` therefore makes the candidate (right) newer.
      return lnum ? 1 : -1
    } else if (left !== right) {
      // Both alphanumeric: plain string order, with the sign flipped because
      // we report the candidate's position relative to the current version.
      return left < right ? 1 : -1
    }
  }
  // More prerelease identifiers sort after fewer (1.0.0-alpha < 1.0.0-alpha.1).
  if (b.prerelease.length !== a.prerelease.length) {
    return b.prerelease.length > a.prerelease.length ? 1 : -1
  }
  return 0
}

/** True only when the feed's version is strictly newer than the running one. */
export function isNewerVersion(current: string, candidate: string): boolean {
  return compareVersions(current, candidate) > 0
}

interface ParsedVersion {
  core: [number, number, number]
  prerelease: string[]
}

function parseVersion(value: string): ParsedVersion | null {
  // Build metadata (`+sha.abc`) does not participate in precedence; strip it
  // before parsing so `1.0.0+build` is a valid 1.0.0.
  const withoutBuild = value.trim().split('+')[0] ?? ''
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/.exec(withoutBuild)
  if (!match) return null
  const core: [number, number, number] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3])
  ]
  const prerelease = match[4] ? match[4].split('.') : []
  return { core, prerelease }
}
