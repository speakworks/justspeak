import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ACCELERATOR } from '../src/core/hotkey/accelerator'
import { ThemeStore } from '../src/main/theme-store'

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

  it('falls back to both defaults when the JSON is not an object', async () => {
    const dir = makeDir()
    await writeFile(preferencesFile(dir), '["light"]', 'utf8')
    await expect(new ThemeStore(dir).loadPreferences()).resolves.toEqual({
      theme: 'system',
      hotkey: DEFAULT_ACCELERATOR
    })
  })
})
