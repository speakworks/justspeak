import type { ResolvedTheme, ThemePreference } from '../../shared/ipc'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
}

/** Unknown or missing stored values fall back to `system`, never to a guess. */
export function parseThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : 'system'
}

/** `system` defers to the OS; the other two pin the result. */
export function resolveTheme(
  preference: ThemePreference,
  systemTheme: ResolvedTheme
): ResolvedTheme {
  return preference === 'system' ? systemTheme : preference
}

/** Next preference when the user cycles the toggle: system → light → dark → system. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(current)
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length] ?? 'system'
}

export const THEME_LABEL: Record<ThemePreference, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色'
}
