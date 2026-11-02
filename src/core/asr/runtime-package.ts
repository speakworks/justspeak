/**
 * Validation for the staged ASR runtime that ships inside the app bundle.
 *
 * `pnpm setup:asr` builds the pinned transcribe.cpp runtime inside a checkout,
 * and CMake bakes the build machine's absolute paths into every binary's
 * `LC_RPATH`. Copying that tree into an app bundle therefore produces binaries
 * that only run on the build machine. Staging flattens the files, rewrites the
 * rpaths to `@loader_path`, and must prove the result is relocatable before
 * electron-builder packs it. The parsing and the checks are pure so they can be
 * unit-tested without a build tree.
 */

export interface RuntimeLinkInput {
  /** File name inside the staged directory, e.g. `transcribe-cli`. */
  file: string
  /** References reported by `otool -L` for that file. */
  dependencies: string[]
}

export interface RuntimeLinkPlan {
  /** Every `@rpath/<name>` dependency the staged files reference, sorted. */
  localNames: string[]
  /** Empty when the staged set is relocatable. */
  problems: string[]
}

/** Libraries that dyld resolves without anything in the bundle. */
const SYSTEM_PREFIXES = ['/usr/lib/', '/System/Library/', '/System/Applications/']

/**
 * Dependencies from `otool -L` output. The first line names the file itself;
 * each remaining line is `<reference> (compatibility version …, current
 * version …)`. Version suffixes are stripped because only the reference matters.
 */
export function parseOtoolDependencies(output: string): string[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(' (compatibility version')[0].trim())
    .filter((line) => line.length > 0)
}

/** Rpaths from `otool -l` output (`LC_RPATH` → `path <value> (offset …)`). */
export function parseRpaths(output: string): string[] {
  const lines = output.split(/\r?\n/)
  const rpaths: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== 'cmd LC_RPATH') continue
    const pathLine = lines
      .slice(index, index + 4)
      .map((line) => line.trim())
      .find((line) => line.startsWith('path '))
    if (!pathLine) continue
    rpaths.push(pathLine.slice('path '.length).split(' (offset')[0].trim())
  }
  return rpaths
}

export function isSystemDependency(reference: string): boolean {
  return SYSTEM_PREFIXES.some((prefix) => reference.startsWith(prefix))
}

/**
 * The file a dependency points at. `@rpath/` is what the pinned build emits;
 * `@loader_path/` and `@executable_path/` are equally valid in the flat staged
 * directory and must not be rejected as absolute paths.
 */
function localDependencyName(reference: string): string | undefined {
  for (const prefix of ['@rpath/', '@loader_path/', '@executable_path/']) {
    if (reference.startsWith(prefix)) return reference.slice(prefix.length)
  }
  return undefined
}

/**
 * Check that every non-system dependency is an `@rpath` reference whose name is
 * staged next to the file. A dylib is allowed to reference itself (the pinned
 * libtranscribe does), because the same file is present in the staged set.
 */
export function planRuntimeLinks(inputs: RuntimeLinkInput[]): RuntimeLinkPlan {
  const files = new Set(inputs.map((input) => input.file))
  const local = new Set<string>()
  const problems: string[] = []

  for (const input of inputs) {
    for (const reference of input.dependencies) {
      if (isSystemDependency(reference)) continue
      const name = localDependencyName(reference)
      if (name === undefined) {
        problems.push(`${input.file} references ${reference}, which is not relocatable`)
        continue
      }
      local.add(name)
      if (!files.has(name)) {
        problems.push(`${input.file} references ${reference}, which is not staged`)
      }
    }
  }

  return { localNames: [...local].sort(), problems }
}

/** A staged rpath is relocatable when it is relative to the loading file. */
export function isRelocatableRpath(rpath: string): boolean {
  return rpath === '@loader_path' || rpath === '@executable_path'
}
