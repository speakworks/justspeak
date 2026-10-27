export type AsrMode = 'qwen3' | 'fake'

export type AsrModeResult = { ok: true; mode: AsrMode } | { ok: false; message: string }

/**
 * Provider selection is explicit: qwen3 is the default, fake is the test
 * escape hatch, and any other value fails closed instead of being coerced.
 */
export function parseAsrMode(value: string | undefined): AsrModeResult {
  if (value === undefined || value === '' || value === 'qwen3') return { ok: true, mode: 'qwen3' }
  if (value === 'fake') return { ok: true, mode: 'fake' }
  return {
    ok: false,
    message: `JUSTSPEAK_ASR 的值不受支持：${value}。可用值：qwen3（默认）或 fake（测试）。`
  }
}
