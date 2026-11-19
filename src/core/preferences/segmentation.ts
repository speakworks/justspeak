/**
 * The three user-facing long-dictation modes. `auto` is the shipped default:
 * short dictation keeps the historical one-shot path and only an utterance
 * above the provider's own limit is segmented. `vad` always segments on
 * silence; `single` always takes the one-shot path.
 *
 * Env parsing (including the historical aliases `on` / `off`) lives with the
 * main-process resolver; this module owns only the persisted preference and the
 * copy both main and the renderer must agree on.
 */

export const SEGMENTATION_PREFERENCES = ['auto', 'vad', 'single'] as const
export type SegmentationPreference = (typeof SEGMENTATION_PREFERENCES)[number]

export const SEGMENTATION_LABELS: Record<SegmentationPreference, string> = {
  auto: '自动（超限才分段）',
  vad: '按静音分段',
  single: '整段不分'
}

/** One short explanation per option, shown under the radio group. */
export const SEGMENTATION_DESCRIPTIONS: Record<SegmentationPreference, string> = {
  auto: '短句不分段，超过模型单次上限时才分段。',
  vad: '按停顿把长句切成多段，逐段识别后按顺序合并。',
  single: '整段一次识别；超过模型单次上限时会识别失败。'
}

export function isSegmentationPreference(value: unknown): value is SegmentationPreference {
  return value === 'auto' || value === 'vad' || value === 'single'
}

/**
 * A missing, corrupt, or unknown stored value is `auto`, matching the shipped
 * default. A preference write that carries such a value is rejected by the
 * merge rules instead; this reader only repairs the disk state.
 */
export function parseSegmentationPreference(value: unknown): SegmentationPreference {
  return isSegmentationPreference(value) ? value : 'auto'
}
