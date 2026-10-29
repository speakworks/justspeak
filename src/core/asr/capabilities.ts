import type { AsrCapabilities } from './types'

/**
 * Render the declared capabilities, never the provider id: adding a third
 * adapter must not require a renderer change.
 */
export function describeCapabilities(capabilities: AsrCapabilities): string {
  const streaming = capabilities.streaming ? '流式' : '非流式'
  const maxSeconds = Math.round(capabilities.maxAudioMs / 1000)
  const languages = capabilities.languages.join('/')
  return `${streaming} · 单次最长 ${maxSeconds} 秒 · ${languages}`
}
