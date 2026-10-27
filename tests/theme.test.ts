import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isThemePreference,
  nextThemePreference,
  parseThemePreference,
  resolveTheme,
  THEME_LABEL,
  THEME_PREFERENCES
} from '../src/core/theme/theme'
import { ThemeStore } from '../src/main/theme-store'

const directories: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-theme-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('theme preference', () => {
  it('accepts only the three documented values', () => {
    expect(THEME_PREFERENCES).toEqual(['system', 'light', 'dark'])
    for (const value of THEME_PREFERENCES) expect(isThemePreference(value)).toBe(true)
    for (const value of ['', 'Dark', 'auto', null, undefined, 1, {}]) {
      expect(isThemePreference(value)).toBe(false)
    }
  })

  it('falls back to system for unknown stored values', () => {
    expect(parseThemePreference('dark')).toBe('dark')
    expect(parseThemePreference('sepia')).toBe('system')
    expect(parseThemePreference(undefined)).toBe('system')
  })

  it('pins light and dark, and defers only for system', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark')
    expect(resolveTheme('system', 'light')).toBe('light')
    expect(resolveTheme('light', 'dark')).toBe('light')
    expect(resolveTheme('dark', 'light')).toBe('dark')
  })

  it('cycles system → light → dark → system', () => {
    expect(nextThemePreference('system')).toBe('light')
    expect(nextThemePreference('light')).toBe('dark')
    expect(nextThemePreference('dark')).toBe('system')
  })

  it('labels every preference', () => {
    for (const value of THEME_PREFERENCES) expect(THEME_LABEL[value]).toBeTruthy()
  })
})

describe('theme store', () => {
  it('starts at system when no file exists', async () => {
    const store = new ThemeStore(makeDir())
    await expect(store.load()).resolves.toBe('system')
  })

  it('round-trips a saved preference', async () => {
    const dir = makeDir()
    const store = new ThemeStore(dir)
    await store.save('light')
    await expect(store.load()).resolves.toBe('light')
    // A second store on the same directory sees the persisted value.
    await expect(new ThemeStore(dir).load()).resolves.toBe('light')
  })

  it('creates the userData directory when it does not exist yet', async () => {
    const nested = path.join(makeDir(), 'deep', 'userData')
    const store = new ThemeStore(nested)
    await store.save('dark')
    await expect(store.load()).resolves.toBe('dark')
  })

  it('falls back to system on corrupt JSON instead of throwing', async () => {
    const dir = makeDir()
    const store = new ThemeStore(dir)
    await store.save('dark')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path.join(dir, 'preferences.json'), '{ not json', 'utf8')
    await expect(store.load()).resolves.toBe('system')
  })

  it('falls back to system when the stored value is not a known preference', async () => {
    const dir = makeDir()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path.join(dir, 'preferences.json'), '{"theme":"sepia"}', 'utf8')
    await expect(new ThemeStore(dir).load()).resolves.toBe('system')
  })
})
