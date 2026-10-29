import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ACCELERATOR } from '../src/core/hotkey/accelerator'
import { parseVocabularyConfig, postprocess } from '../src/core/postprocess'
import { ThemeStore, type ThemeStoreDeps } from '../src/main/theme-store'
import { VOCABULARY_FILE, VocabularyStore } from '../src/main/vocabulary-store'

const directories: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-preferences-'))
  directories.push(dir)
  return dir
}

function preferencesFile(dir: string): string {
  return path.join(dir, 'preferences.json')
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('preferences store', () => {
  it('starts every preference at its default when no file exists', async () => {
    await expect(new ThemeStore(makeDir()).loadPreferences()).resolves.toEqual({
      theme: 'system',
      hotkey: DEFAULT_ACCELERATOR
    })
  })

  it('keeps the theme when the hotkey is written', async () => {
    const dir = makeDir()
    const store = new ThemeStore(dir)
    await store.save('dark')
    await store.saveHotkey('Command+Shift+K')
    await expect(store.loadPreferences()).resolves.toEqual({
      theme: 'dark',
      hotkey: 'Command+Shift+K'
    })
    expect(JSON.parse(await readFile(preferencesFile(dir), 'utf8'))).toEqual({
      theme: 'dark',
      hotkey: 'Command+Shift+K'
    })
  })

  it('keeps the hotkey when the theme is written', async () => {
    const dir = makeDir()
    const store = new ThemeStore(dir)
    await store.saveHotkey('Control+Alt+H')
    await store.save('light')
    await expect(store.loadPreferences()).resolves.toEqual({
      theme: 'light',
      hotkey: 'Control+Alt+H'
    })
  })

  it('preserves unrelated keys written by another feature', async () => {
    const dir = makeDir()
    await writeFile(
      preferencesFile(dir),
      JSON.stringify({ theme: 'light', hotkey: 'Command+K', future: { keep: true } }),
      'utf8'
    )
    const store = new ThemeStore(dir)
    await store.saveHotkey('Alt+Shift+J')
    expect(JSON.parse(await readFile(preferencesFile(dir), 'utf8'))).toEqual({
      theme: 'light',
      hotkey: 'Alt+Shift+J',
      future: { keep: true }
    })
  })

  it('canonicalizes a stored accelerator and rejects a modifier-less one', async () => {
    const dir = makeDir()
    await writeFile(
      preferencesFile(dir),
      JSON.stringify({ theme: 'dark', hotkey: 'cmd+shift+k' }),
      'utf8'
    )
    await expect(new ThemeStore(dir).loadPreferences()).resolves.toEqual({
      theme: 'dark',
      hotkey: 'Command+Shift+K'
    })
    await writeFile(
      preferencesFile(dir),
      JSON.stringify({ theme: 'dark', hotkey: 'Space' }),
      'utf8'
    )
    await expect(new ThemeStore(dir).loadPreferences()).resolves.toEqual({
      theme: 'dark',
      hotkey: DEFAULT_ACCELERATOR
    })
  })

  it('falls back to both defaults on corrupt JSON without throwing', async () => {
    const dir = makeDir()
    await writeFile(preferencesFile(dir), '{ not json', 'utf8')
    const store = new ThemeStore(dir)
    await expect(store.loadPreferences()).resolves.toEqual({
      theme: 'system',
      hotkey: DEFAULT_ACCELERATOR
    })
    // A save after corruption repairs the file instead of failing.
    await store.save('dark')
    await expect(store.loadPreferences()).resolves.toEqual({
      theme: 'dark',
      hotkey: DEFAULT_ACCELERATOR
    })
  })

  it('resolves a prototype-named stored hotkey to the default', async () => {
    const dir = makeDir()
    await writeFile(
      preferencesFile(dir),
      JSON.stringify({ theme: 'dark', hotkey: 'constructor+Space' }),
      'utf8'
    )
    await expect(new ThemeStore(dir).loadPreferences()).resolves.toEqual({
      theme: 'dark',
      hotkey: DEFAULT_ACCELERATOR
    })
  })

  it('serialises concurrent saves so neither key is lost', async () => {
    const dir = makeDir()
    const slowDeps: ThemeStoreDeps = {
      readFile,
      mkdir,
      writeFile: async (file, data, options) => {
        // Widen the read-modify-write window: without the store's write chain
        // both saves read the old file and the later write drops the other key.
        await new Promise((resolve) => setTimeout(resolve, 5))
        await writeFile(file, data, options)
      }
    }
    const store = new ThemeStore(dir, slowDeps)
    await Promise.all([store.save('dark'), store.saveHotkey('Command+Shift+K')])
    await expect(store.loadPreferences()).resolves.toEqual({
      theme: 'dark',
      hotkey: 'Command+Shift+K'
    })
  })

  it('warns and falls back when the file exists but cannot be read', async () => {
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const deps: ThemeStoreDeps = {
      readFile: async () => {
        throw failure
      },
      writeFile,
      mkdir
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(new ThemeStore(makeDir(), deps).loadPreferences()).resolves.toEqual({
        theme: 'system',
        hotkey: DEFAULT_ACCELERATOR
      })
      // A read failure must not reset preferences silently.
      expect(warn).toHaveBeenCalled()
      expect(String(warn.mock.calls[0]?.[0])).toContain('could not read')
    } finally {
      warn.mockRestore()
    }
  })

  it('stays silent when the file is simply missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(new ThemeStore(makeDir()).loadPreferences()).resolves.toEqual({
        theme: 'system',
        hotkey: DEFAULT_ACCELERATOR
      })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('falls back to both defaults when the JSON is not an object', async () => {
    const dir = makeDir()
    await writeFile(preferencesFile(dir), '["light"]', 'utf8')
    await expect(new ThemeStore(dir).loadPreferences()).resolves.toEqual({
      theme: 'system',
      hotkey: DEFAULT_ACCELERATOR
    })
  })
})

describe('vocabulary config parsing', () => {
  it('accepts an array of replacement pairs', () => {
    expect(
      parseVocabularyConfig({
        replace: [{ from: '库贝内特斯', to: 'Kubernetes' }],
        protect: ['JustSpeak']
      })
    ).toEqual({
      vocabulary: {
        replace: [{ from: '库贝内特斯', to: 'Kubernetes' }],
        protect: ['JustSpeak']
      }
    })
  })

  it('accepts a wrong-to-right object map', () => {
    expect(parseVocabularyConfig({ replace: { kubnernetes: 'Kubernetes' } })).toEqual({
      vocabulary: { replace: [{ from: 'kubnernetes', to: 'Kubernetes' }], protect: [] }
    })
  })

  it('drops unknown rules and wrong types instead of throwing', () => {
    expect(
      parseVocabularyConfig({
        replace: [{ from: '', to: 'x' }, { from: 'a', to: '' }, 'nope'],
        protect: ['ok', '', 7, 'ok'],
        rules: { filler: false, normalize: 'no', mystery: true },
        repetitionThreshold: 99
      })
    ).toEqual({
      vocabulary: { replace: [], protect: ['ok'] },
      rules: { filler: false }
    })
  })

  it('ignores non-config payloads', () => {
    for (const value of [null, undefined, 'x', 3, ['replace']]) {
      expect(parseVocabularyConfig(value)).toEqual({})
    }
  })

  it('rejects a Han threshold below the floor of 3', () => {
    expect(parseVocabularyConfig({ repetitionThreshold: 2 })).toEqual({})
    expect(parseVocabularyConfig({ repetitionThreshold: 3 })).toEqual({
      repetitionThreshold: 3
    })
  })
})

describe('vocabulary store', () => {
  it('returns defaults when no file exists', async () => {
    const store = new VocabularyStore(makeDir())
    await expect(store.load()).resolves.toEqual({})
  })

  it('round-trips a saved word list', async () => {
    const dir = makeDir()
    const store = new VocabularyStore(dir)
    const options = {
      vocabulary: {
        replace: [{ from: '库贝内特斯', to: 'Kubernetes' }],
        protect: ['JustSpeak', 'FD2008']
      },
      rules: { filler: false },
      repetitionThreshold: 3
    }
    await store.save(options)
    await expect(store.load()).resolves.toEqual(options)
    // A second store on the same directory sees the persisted value.
    await expect(new VocabularyStore(dir).load()).resolves.toEqual(options)
  })

  it('creates the userData directory when it does not exist yet', async () => {
    const nested = path.join(makeDir(), 'deep', 'userData')
    const store = new VocabularyStore(nested)
    await store.save({ vocabulary: { replace: [{ from: 'x', to: 'y' }], protect: [] } })
    await expect(store.load()).resolves.toMatchObject({
      vocabulary: { replace: [{ from: 'x', to: 'y' }] }
    })
  })

  it('falls back to defaults on corrupt JSON', async () => {
    const dir = makeDir()
    await writeFile(path.join(dir, VOCABULARY_FILE), '{ not json', 'utf8')
    await expect(new VocabularyStore(dir).load()).resolves.toEqual({})
  })

  it('falls back to defaults when the payload is not an object', async () => {
    const dir = makeDir()
    await writeFile(path.join(dir, VOCABULARY_FILE), '"hello"', 'utf8')
    await expect(new VocabularyStore(dir).load()).resolves.toEqual({})
  })

  it('uses a file separate from preferences.json', async () => {
    const dir = makeDir()
    const store = new VocabularyStore(dir)
    await store.save({ vocabulary: { replace: [], protect: ['JustSpeak'] } })
    expect(await readdir(dir)).toEqual([VOCABULARY_FILE])
    expect(VOCABULARY_FILE).toBe('vocabulary.json')
  })

  it('feeds the loaded config into the pure stage', async () => {
    const dir = makeDir()
    await writeFile(
      path.join(dir, VOCABULARY_FILE),
      JSON.stringify({
        replace: [{ from: '库贝内特斯', to: 'Kubernetes' }],
        protect: ['JustSpeak'],
        rules: { repetition: false }
      }),
      'utf8'
    )
    const options = await new VocabularyStore(dir).load()
    expect(postprocess('嗯，用库贝内特斯和 JustSpeak。', options).text).toBe(
      '用Kubernetes和 JustSpeak。'
    )
    // The disabled rule is honoured from the same file.
    expect(postprocess('我我我', options).text).toBe('我我我')
  })
})
