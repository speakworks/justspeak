import type { SelectableAsrProviderId } from '../../shared/ipc'

/**
 * The repair hint after a failed first-run download must be true for the
 * selected provider: `pnpm setup:asr` only prepares the Qwen3 catalog entry,
 * so naming it for SenseVoice would send the user to a step that cannot fix
 * the failure.
 */
export function downloadFailureHint(
  providerId: SelectableAsrProviderId,
  modelName: string,
  modelPath: string
): string {
  if (providerId === 'qwen3') return '可运行 pnpm setup:asr 手动准备 Qwen3 模型。'
  return `可将 ${modelName} 的模型文件放到 ${modelPath}。`
}

/**
 * The repair hint when the ASR runtime binary is missing.
 *
 * `pnpm setup:asr` only exists in a checkout, and it writes into the
 * repository's `models/`. A packaged app reads the runtime from the user's data
 * directory, so telling a packaged user to run it sends them to a step that
 * cannot fix anything. Say where the binary has to be instead.
 */
export function runtimeMissingHint(input: {
  packaged: boolean
  cliPath: string
  sourceUrl?: string
}): string {
  const source = input.sourceUrl ? `（运行时来源：${input.sourceUrl}）` : ''
  if (!input.packaged) {
    return `请运行 pnpm setup:asr${source}。`
  }
  return (
    `可用 JUSTSPEAK_TRANSCRIBE_CLI 指向一个依赖路径可重定位的 transcribe-cli${source}；` +
    `当前包里没有随附运行时，直接把它拷到 ${input.cliPath} 还需要它的 dylib 能从该位置解析。`
  )
}
