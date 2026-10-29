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
