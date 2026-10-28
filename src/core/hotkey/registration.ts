import { DEFAULT_ACCELERATOR } from './accelerator'
import type { HotkeySource } from './types'

export interface HotkeyRegistrationOutcome {
  /** The accelerator that is actually registered; `''` when none is. */
  accelerator: string
  /** True only when the requested binding registered successfully. */
  ok: boolean
  fallbackUsed: boolean
  /** Present whenever the user must know something went wrong. */
  message?: string
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Register the requested binding, falling back to the default when it is taken.
 * The failed binding is named in the message so the user can free it; a failed
 * fallback is reported too rather than silently leaving the app with no hotkey.
 */
export async function registerHotkeyWithFallback(
  source: HotkeySource,
  requested: string,
  fallback: string = DEFAULT_ACCELERATOR
): Promise<HotkeyRegistrationOutcome> {
  try {
    const primary = await source.start([{ accelerator: requested }])
    if (primary.failed.length === 0) {
      return { accelerator: requested, ok: true, fallbackUsed: false }
    }
  } catch (error) {
    return {
      accelerator: '',
      ok: false,
      fallbackUsed: false,
      message: `无法注册 ${requested}：${describe(error)}`
    }
  }

  if (requested === fallback) {
    return {
      accelerator: '',
      ok: false,
      fallbackUsed: false,
      message: `无法注册 ${requested}，可能已被其他应用占用。`
    }
  }

  try {
    const secondary = await source.start([{ accelerator: fallback }])
    if (secondary.failed.length === 0) {
      return {
        accelerator: fallback,
        ok: false,
        fallbackUsed: true,
        // Keep this line short enough for the settings row; the renderer shows
        // the actual registered accelerator separately.
        message: `无法注册 ${requested}（可能已被其他应用占用），已回退到默认快捷键。`
      }
    }
  } catch (error) {
    return {
      accelerator: '',
      ok: false,
      fallbackUsed: false,
      message: `无法注册 ${requested}；默认快捷键 ${fallback} 也不可用：${describe(error)}`
    }
  }

  return {
    accelerator: '',
    ok: false,
    fallbackUsed: false,
    message: `无法注册 ${requested}；默认快捷键 ${fallback} 也不可用。`
  }
}
