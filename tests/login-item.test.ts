import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// The adapter imports Electron's app at module scope. Unit tests run without
// Electron, so the whole module is replaced; the test bodies drive the two
// functions the adapter is allowed to call.
vi.mock('electron', () => ({
  app: {
    getLoginItemSettings: vi.fn(),
    setLoginItemSettings: vi.fn()
  }
}))

import { app } from 'electron'
import {
  LOGIN_ITEM_REFUSED_OFF_REASON,
  LOGIN_ITEM_REFUSED_ON_REASON,
  planStartupAutostart,
  resolveAutostartWrite
} from '../src/core/preferences/autostart'
import { mergePreferences } from '../src/core/preferences/merge'
import { createLoginItemController, LoginItemController } from '../src/main/login-item'
import { ThemeStore } from '../src/main/theme-store'

const mockGet = app.getLoginItemSettings as unknown as Mock
const mockSet = app.setLoginItemSettings as unknown as Mock

const directories: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-login-item-'))
  directories.push(dir)
  return dir
}

function controller(): LoginItemController {
  return createLoginItemController()
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('login item adapter', () => {
  it('reads the OS state instead of a cached preference', () => {
    mockGet.mockReturnValue({ openAtLogin: true })
    expect(controller().read()).toEqual({ available: true, openAtLogin: true })

    mockGet.mockReturnValue({ openAtLogin: false })
    expect(controller().read()).toEqual({ available: true, openAtLogin: false })
  })

  it('writes the requested value and then re-reads the OS', () => {
    mockGet.mockReturnValue({ openAtLogin: false })
    const result = controller().set(false)

    expect(mockSet).toHaveBeenCalledWith({ openAtLogin: false })
    expect(mockGet).toHaveBeenCalledTimes(1)
    // The answer comes from the read-back, not from the request.
    expect(result).toEqual({ ok: true, openAtLogin: false })
  })

  it('does not trust the requested value when the OS reports something else', () => {
    // set(true) is a no-op in an unsigned build; the read still says off.
    mockGet.mockReturnValue({ openAtLogin: false })
    const result = controller().set(true)

    expect(mockSet).toHaveBeenCalledWith({ openAtLogin: true })
    expect(result).toEqual({
      ok: false,
      openAtLogin: false,
      message: LOGIN_ITEM_REFUSED_ON_REASON
    })
  })

  it('reports a refused disable with the off-specific reason', () => {
    mockGet.mockReturnValue({ openAtLogin: true })
    expect(controller().set(false)).toMatchObject({
      ok: false,
      openAtLogin: true,
      message: LOGIN_ITEM_REFUSED_OFF_REASON
    })
  })

  it('reports unavailable instead of throwing when the read fails', () => {
    mockGet.mockImplementation(() => {
      throw new Error('denied')
    })

    expect(controller().read()).toEqual({
      available: false,
      openAtLogin: false,
      message: expect.stringContaining('denied')
    })
    // A failed read after set is a failed change, not a crash.
    expect(controller().set(true)).toMatchObject({
      ok: false,
      message: expect.stringContaining('denied')
    })
  })

  it('reports a failed write without reading a stale state', () => {
    mockSet.mockImplementation(() => {
      throw new Error('not supported')
    })

    expect(controller().set(true)).toEqual({
      ok: false,
      message: expect.stringContaining('not supported')
    })
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('treats a missing or malformed OS answer as off, not as a crash', () => {
    mockGet.mockReturnValue({})
    expect(controller().read()).toEqual({ available: true, openAtLogin: false })
  })
})

describe('first-run plan', () => {
  it('seeds the built-in default only when no choice is stored', () => {
    expect(planStartupAutostart(undefined)).toEqual({ seedDefault: true })
    expect(planStartupAutostart(true)).toEqual({ seedDefault: false })
    // An explicit off is a stored choice; startup must not override it.
    expect(planStartupAutostart(false)).toEqual({ seedDefault: false })
  })
})

describe('write verdict', () => {
  it('marks the write ok only when the read-back matches the request', () => {
    expect(resolveAutostartWrite(true, { available: true, openAtLogin: true })).toEqual({
      ok: true,
      openAtLogin: true
    })
    expect(resolveAutostartWrite(false, { available: true, openAtLogin: false })).toEqual({
      ok: true,
      openAtLogin: false
    })
  })

  it('carries the unavailability reason through', () => {
    expect(
      resolveAutostartWrite(true, {
        available: false,
        openAtLogin: false,
        message: '无法读取登录项状态：boom'
      })
    ).toEqual({ ok: false, message: '无法读取登录项状态：boom' })
  })
})

describe('preferences persistence', () => {
  it('distinguishes an absent launchAtLogin from an explicit false', async () => {
    const dir = makeDir()
    const store = new ThemeStore(dir)

    await expect(store.loadPreferences()).resolves.toMatchObject({
      launchAtLogin: undefined
    })
    await store.update({ launchAtLogin: false })
    await expect(store.loadPreferences()).resolves.toMatchObject({
      launchAtLogin: false
    })
    expect(JSON.parse(await readFile(path.join(dir, 'preferences.json'), 'utf8'))).toEqual({
      launchAtLogin: false
    })
  })

  it('preserves launchAtLogin when another preference is written', async () => {
    const dir = makeDir()
    const store = new ThemeStore(dir)
    await store.update({ launchAtLogin: false })
    await store.save('dark')

    expect(JSON.parse(await readFile(path.join(dir, 'preferences.json'), 'utf8'))).toEqual({
      launchAtLogin: false,
      theme: 'dark'
    })
  })

  it('rejects a non-boolean value without writing any part of the patch', async () => {
    const dir = makeDir()
    const store = new ThemeStore(dir)
    await store.save('dark')
    const before = await readFile(path.join(dir, 'preferences.json'), 'utf8')

    const result = await store.update({ launchAtLogin: 'yes', theme: 'light' })
    expect(result.ok).toBe(false)
    expect(result.rejected[0]?.key).toBe('launchAtLogin')
    expect(await readFile(path.join(dir, 'preferences.json'), 'utf8')).toBe(before)
  })

  it('merges the key like every other preference', () => {
    const result = mergePreferences({ theme: 'light', future: { keep: true } }, {
      launchAtLogin: true
    })
    expect(result.ok).toBe(true)
    expect(result.record).toEqual({
      theme: 'light',
      future: { keep: true },
      launchAtLogin: true
    })
  })
})
