/**
 * Build a signed, notarised macOS artifact.
 *
 *   pnpm package:mac:signed            # DMG + ZIP, signed and notarised
 *   pnpm package:mac:signed -- --dir   # unpacked .app only
 *
 * The default local configuration stays unsigned (`identity: null`,
 * `notarize: false`). This script is the only path that turns signing on: it
 * refuses to start until the release environment provides a Developer ID
 * identity and one complete notarisation credential pair, then passes the
 * hardened-runtime settings the base config deliberately leaves off.
 *
 * Required:
 *   CSC_NAME                              "Developer ID Application: Name (TEAMID)"
 *   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
 *     or APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER
 *     or APPLE_KEYCHAIN_PROFILE (APPLE_KEYCHAIN optional)
 * Optional:
 *   CSC_LINK, CSC_KEY_PASSWORD            a base64 .p12 for CI keychains
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkSigningEnv } from '../src/core/packaging/signing-env'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTITLEMENTS = path.join(ROOT, 'resources/entitlements.mac.plist')
const unpackedOnly = process.argv.includes('--dir')

function main(): void {
  const environment = checkSigningEnv(process.env)
  if (!environment.ok) {
    console.error('package-mac-signed: signing credentials are incomplete.')
    console.error('Missing:')
    for (const variable of environment.missing) console.error(`  - ${variable}`)
    console.error(
      'See docs/PACKAGING-RELEASE.md「Signing readiness」for the expected values. ' +
        'Local development does not need this path: use pnpm package:mac.'
    )
    process.exit(1)
  }

  if (!existsSync(ENTITLEMENTS)) {
    console.error(`package-mac-signed: entitlements file not found at ${ENTITLEMENTS}`)
    process.exit(1)
  }

  const identity = process.env.CSC_NAME as string
  const entitlements = path.relative(ROOT, ENTITLEMENTS)
  const args = [
    'electron-builder',
    '--mac',
    '--arm64',
    `-c.mac.identity=${identity}`,
    '-c.mac.hardenedRuntime=true',
    `-c.mac.entitlements=${entitlements}`,
    `-c.mac.entitlementsInherit=${entitlements}`,
    '-c.mac.notarize=true',
    // Same rule as the unsigned scripts: a local/signed build never uploads.
    // Publishing is the release workflow's explicit final step.
    '--publish',
    'never'
  ]
  if (unpackedOnly) args.push('--dir')

  console.log(`Signing with ${identity}${unpackedOnly ? ' (unpacked only)' : ''}`)
  const result = spawnSync('pnpm', ['exec', ...args], { cwd: ROOT, stdio: 'inherit' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }

  const app = path.join(ROOT, 'release/mac-arm64/JustSpeak.app')
  console.log(`\nNext: pnpm verify:mac ${path.relative(ROOT, app)} --require-distribution`)
}

main()
