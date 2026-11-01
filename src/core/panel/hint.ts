/**
 * The copy panel's one-line hint. Escape is a temporary global shortcut, and
 * macOS can refuse that registration; the UI must not promise a key that is
 * not actually registered.
 */
export function panelHint(canEscape: boolean): string {
  return canEscape ? '文字未自动粘贴 · Esc 关闭' : '文字未自动粘贴'
}
