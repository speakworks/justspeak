import { describe, expect, it } from 'vitest'
import {
  isRelocatableRpath,
  parseOtoolDependencies,
  parseRpaths,
  planRuntimeLinks
} from '../src/core/asr/runtime-package'

const CLI_LINKS = [
  '\t@rpath/libtranscribe.0.4.dylib (compatibility version 0.4.0, current version 0.4.1)',
  '\t/usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 2200.27.0)',
  '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1359.0.0)'
].join('\n')

describe('otool parsing', () => {
  it('skips the file header and strips version suffixes', () => {
    const output = `transcribe-cli:\n${CLI_LINKS}\n`
    expect(parseOtoolDependencies(output)).toEqual([
      '@rpath/libtranscribe.0.4.dylib',
      '/usr/lib/libc++.1.dylib',
      '/usr/lib/libSystem.B.dylib'
    ])
  })

  it('reads every LC_RPATH value', () => {
    const output = [
      'Load command 8',
      '          cmd LC_RPATH',
      '      cmdsize 56',
      '         path /Users/me/build/ggml/src (offset 12)',
      'Load command 9',
      '          cmd LC_RPATH',
      '      cmdsize 64',
      '         path /Users/me/build/ggml/src/ggml-metal (offset 12)'
    ].join('\n')
    expect(parseRpaths(output)).toEqual([
      '/Users/me/build/ggml/src',
      '/Users/me/build/ggml/src/ggml-metal'
    ])
  })
})

describe('runtime link plan', () => {
  it('accepts a flat set whose only local references are staged', () => {
    const plan = planRuntimeLinks([
      { file: 'transcribe-cli', dependencies: parseOtoolDependencies(`x:\n${CLI_LINKS}`) },
      { file: 'libtranscribe.0.4.dylib', dependencies: ['@rpath/libggml.0.dylib'] },
      { file: 'libggml.0.dylib', dependencies: [] }
    ])
    expect(plan.problems).toEqual([])
    expect(plan.localNames).toEqual(['libggml.0.dylib', 'libtranscribe.0.4.dylib'])
  })

  it('rejects a dependency that is not staged', () => {
    const plan = planRuntimeLinks([
      { file: 'transcribe-cli', dependencies: ['@rpath/libtranscribe.0.4.dylib'] }
    ])
    expect(plan.problems).toEqual([
      'transcribe-cli references @rpath/libtranscribe.0.4.dylib, which is not staged'
    ])
  })

  it('rejects an absolute dependency from the build machine', () => {
    const plan = planRuntimeLinks([
      {
        file: 'libtranscribe.0.4.dylib',
        dependencies: ['/Users/me/build/ggml/src/libggml.0.dylib']
      }
    ])
    expect(plan.problems).toEqual([
      'libtranscribe.0.4.dylib references /Users/me/build/ggml/src/libggml.0.dylib, which is not relocatable'
    ])
  })

  it('accepts loader-relative and executable-relative references', () => {
    const plan = planRuntimeLinks([
      { file: 'transcribe-cli', dependencies: ['@loader_path/libtranscribe.0.4.dylib'] },
      { file: 'libtranscribe.0.4.dylib', dependencies: ['@executable_path/libggml.0.dylib'] },
      { file: 'libggml.0.dylib', dependencies: [] }
    ])
    expect(plan.problems).toEqual([])
    expect(plan.localNames).toEqual(['libggml.0.dylib', 'libtranscribe.0.4.dylib'])
  })

  it('allows a dylib to reference itself, because the file is staged', () => {
    const plan = planRuntimeLinks([
      { file: 'libtranscribe.0.4.dylib', dependencies: ['@rpath/libtranscribe.0.4.dylib'] }
    ])
    expect(plan.problems).toEqual([])
  })

  it('ignores system libraries and framework paths', () => {
    const plan = planRuntimeLinks([
      {
        file: 'libggml.0.dylib',
        dependencies: [
          '/usr/lib/libSystem.B.dylib',
          '/System/Library/Frameworks/Accelerate.framework/Versions/A/Accelerate'
        ]
      }
    ])
    expect(plan.problems).toEqual([])
  })
})

describe('rpath relocation', () => {
  it('accepts loader-relative rpaths only', () => {
    expect(isRelocatableRpath('@loader_path')).toBe(true)
    expect(isRelocatableRpath('@executable_path')).toBe(true)
    expect(isRelocatableRpath('/Users/me/build/ggml/src')).toBe(false)
  })
})
