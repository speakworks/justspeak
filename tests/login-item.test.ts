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
  applyAutostartChoice,
  LOGIN_ITEM_REFUSED_OFF_REASON,
  LOGIN_ITEM_REFUSED_ON_REASON,
  LOGIN_ITEM_REQUIRES_APPROVAL_REASON,
  planStartupAutostart,
  readAutostartView,
  resolveAutostartWrite,
  seedAutostartOnFirstRun
} from '../src/core/preferences/autostart'
import { mergePreferences } from '../src/core/preferences/merge'
import { createLoginItemController, LoginItemController } from '../src/main/login-item'
import { ThemeStore } from '../src/main/theme-store'
import type { LoginItemView } from '../src/shared/ipc'

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

function on(): LoginItemView {
  return { available: true, openAtLogin: true, status: 'enabled' }
}

function off(): LoginItemView {
  return { available: true, openAtLogin: false, status: 'not-registered' }
}

beforeEach(() => {
  // Reset implementations too: an earlier test's "set throws" mock must not
  // leak into the next one.
  vi.resetAllMocks()
})

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('login item adapter', () => {
  it('reads the OS state instead of a cached preference', () => {
    mockGet.mockReturnValue({ openAtLogin: true })
    expect(controller().read()).toEqual(on())

    mockGet.mockReturnValue({ openAtLogin: false })
    expect(controller().read()).toEqual(off())
  })

  it('keeps the macOS requires-approval status instead of flattening it to off', () => {
    mockGet.mockReturnValue({ openAtLogin: false, status: 'requires-approval' })
    expect(controller().read()).toEqual({
      available: true,
      openAtLogin: false,
      status: 'requires-approval'
    })
  })

  it('trusts the status over the boolean when macOS reports both', () => {
    mockGet.mockReturnValue({ openAtLogin: true, status: 'not-registered' })
    expect(controller().read()).toMatchObject({ openAtLogin: false, status: 'not-registered' })
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

  it('reports requires-approval with its own reason', () => {
    mockGet.mockReturnValue({ openAtLogin: false, status: 'requires-approval' })
    expect(controller().set(true)).toMatchObject({
      ok: false,
      openAtLogin: false,
      message: LOGIN_ITEM_REQUIRES_APPROVAL_REASON
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
      status: 'not-registered',
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

  it('treats a malformed OS answer as off, not as a crash', () => {
    mockGet.mockReturnValue({})
    expect(controller().read()).toEqual(off())
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

describe('startup seeding wiring', () => {
  it('does not call setLoginItemSettings when a choice is already stored', async () => {
    mockGet.mockReturnValue({ openAtLogin: false })
    const persist = vi.fn()

    await seedAutostartOnFirstRun(false, {
      read: () => controller().read(),
      set: (value) => controller().set(value),
      persist
    })
    await seedAutostartOnFirstRun(true, {
      read: () => controller().read(),
      set: (value) => controller().set(value),
      persist
    })

    expect(mockSet).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  it('persists the default only when the OS confirms it', async () => {
    const persist = vi.fn()
    // A first-run set that macOS refuses: nothing may be recorded, so the next
    // launch retries instead of treating "not registered" as a user choice.
    mockGet.mockReturnValue({ openAtLogin: false })
    const refused = await seedAutostartOnFirstRun(undefined, {
      read: () => controller().read(),
      set: (value) => controller().set(value),
      persist
    })
    expect(refused?.ok).toBe(false)
    expect(persist).not.toHaveBeenCalled()

    // A confirmed set records exactly what the OS reported.
    mockGet.mockReturnValue({ openAtLogin: true })
    const confirmed = await seedAutostartOnFirstRun(undefined, {
      read: () => controller().read(),
      set: (value) => controller().set(value),
      persist
    })
    expect(confirmed?.ok).toBe(true)
    expect(persist).toHaveBeenCalledWith(true)
  })
})

describe('toggle wiring', () => {
  it('persists the read-back rather than the requested value', async () => {
    const persist = vi.fn()
    // Deliberately inconsistent ports: the write claims success but the OS
    // reports off. Only the read-back may reach persistence.
    const result = await applyAutostartChoice(true, {
      set: () => ({ ok: true, openAtLogin: false }),
      persist
    })

    expect(result).toEqual({ ok: true, openAtLogin: false })
    expect(persist).toHaveBeenCalledWith(false)
  })

  it('persists nothing when the OS refuses the change', async () => {
    mockGet.mockReturnValue({ openAtLogin: false })
    const persist = vi.fn()
    const result = await applyAutostartChoice(true, {
      set: (value) => controller().set(value),
      persist
    })

    expect(result.ok).toBe(false)
    expect(persist).not.toHaveBeenCalled()
  })
})

describe('preferences read wiring', () => {
  it('asks the OS once per preferences read instead of caching', () => {
    mockGet.mockReturnValue({ openAtLogin: true })
    const first = readAutostartView(() => controller().read())
    const second = readAutostartView(() => controller().read())

    expect(mockGet).toHaveBeenCalledTimes(2)
    expect(first).toEqual(on())
    expect(second).toEqual(on())
  })

  it('attaches a refusal notice to an otherwise available view', () => {
    mockGet.mockReturnValue({ openAtLogin: false })
    const view = readAutostartView(() => controller().read(), '系统没有接受设置。')
    expect(view).toMatchObject({ available: true, message: '系统没有接受设置。' })
  })
})

describe('write verdict', () => {
  it('marks the write ok only when the read-back matches the request', () => {
    expect(resolveAutostartWrite(true, on())).toEqual({ ok: true, openAtLogin: true })
    expect(resolveAutostartWrite(false, off())).toEqual({ ok: true, openAtLogin: false })
  })

  it('carries the unavailability reason through', () => {
    expect(
      resolveAutostartWrite(true, {
        available: false,
        openAtLogin: false,
        status: 'not-registered',
        message: '无法读取登录项状态：boom'
      })
    ).toEqual({ ok: false, message: '无法读取登录项状态：boom' })
  })

  it('treats turning it off as satisfied while approval is pending', () => {
    expect(
      resolveAutostartWrite(false, {
        available: true,
        openAtLogin: false,
        status: 'requires-approval'
      })
    ).toEqual({ ok: true, openAtLogin: false })
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
