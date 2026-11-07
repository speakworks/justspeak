/**
 * Build the macOS icon assets from the two SVG sources in `resources/`.
 *
 *   node scripts/build-icons.mjs
 *
 * Produces, all committed so a clean clone can package without extra tooling:
 *
 *   resources/icon.icns           application icon (Dock, Finder, DMG)
 *   resources/trayTemplate.png    16 pt menu-bar mark, @1x
 *   resources/trayTemplate@2x.png 16 pt menu-bar mark, @2x
 *
 * The sources are hand-authored SVG, so this script is a build step rather than
 * a design step: it only rasterises and assembles. `rsvg-convert` and the macOS
 * `iconutil`/`sips` are required, which is why the outputs are committed instead
 * of being generated during `pnpm package:mac` on a machine that may lack them.
 *
 * The menu-bar PNGs must stay black-on-transparent with the "Template" suffix:
 * macOS derives both the light and the dark appearance from the alpha channel.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RESOURCES = path.join(ROOT, 'resources')

/** The `iconutil` icon-set members and the SVG-to-PNG size each needs. */
const ICONSET = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

function main() {
  const appSvg = path.join(RESOURCES, 'icon.svg')
  const traySvg = path.join(RESOURCES, 'trayTemplate.svg')
  if (!statSync(appSvg).isFile()) throw new Error(`missing ${appSvg}`)
  if (!statSync(traySvg).isFile()) throw new Error(`missing ${traySvg}`)

  // `iconutil` rejects a directory whose name does not end in `.iconset`, so the
  // temp directory must carry exactly that suffix (not `.iconset.tmp`).
  const iconset = path.join(RESOURCES, 'icon.iconset')
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  try {
    for (const [name, size] of ICONSET) {
      run('rsvg-convert', ['-w', String(size), '-h', String(size), appSvg, '-o', path.join(iconset, name)])
    }
    run('iconutil', ['-c', 'icns', iconset, '-o', path.join(RESOURCES, 'icon.icns')])
  } finally {
    rmSync(iconset, { recursive: true, force: true })
  }

  // A 16 pt menu-bar slot is 16 px at 1x and 32 px at 2x.
  for (const [name, size] of [
    ['trayTemplate.png', 16],
    ['trayTemplate@2x.png', 32]
  ]) {
    run('rsvg-convert', ['-w', String(size), '-h', String(size), traySvg, '-o', path.join(RESOURCES, name)])
  }

  for (const file of ['icon.icns', 'trayTemplate.png', 'trayTemplate@2x.png']) {
    const full = path.join(RESOURCES, file)
    console.log(`${file}  ${statSync(full).size} bytes`)
  }
}

main()
