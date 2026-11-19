import { describe, expect, it } from 'vitest'
import { DEFAULT_VAD_CONFIG } from '../src/core/audio/vad'
import {
  formatEnvFallbackMessage,
  formatEnvTakeoverMessage,
  parseSegmentationConfig,
  parseSegmentationMode,
  resolveSegmentationMode,
  shouldRebuildForSegmentation
} from '../src/main/asr/segmentation-mode'

describe('parseSegmentationMode', () => {
  it.each([
    [undefined, 'auto'],
    ['', 'auto'],
    ['single', 'single'],
    ['off', 'single'],
    ['vad', 'vad'],
    ['on', 'vad'],
    ['segmented', 'vad']
  ] as const)('maps %s to %s', (value, mode) => {
    expect(parseSegmentationMode(value)).toEqual({ ok: true, mode })
  })

  it('fails closed on an unknown value', () => {
    const result = parseSegmentationMode('loud')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('JUSTSPEAK_SEGMENTED')
    expect(result.message).toContain('loud')
  })
})

describe('segmentation resolution', () => {
  it('lets a valid env value override the stored preference', () => {
    expect(resolveSegmentationMode({ JUSTSPEAK_SEGMENTED: 'vad' }, 'single')).toEqual({
      effective: 'vad',
      source: 'env',
      envValue: 'vad',
      message: '当前由环境变量接管（JUSTSPEAK_SEGMENTED=vad）'
    })
  })

  it('accepts the historical aliases in the env value', () => {
    expect(resolveSegmentationMode({ JUSTSPEAK_SEGMENTED: 'on' }, 'single')).toMatchObject({
      effective: 'vad',
      source: 'env'
    })
    expect(resolveSegmentationMode({ JUSTSPEAK_SEGMENTED: 'off' }, 'vad')).toMatchObject({
      effective: 'single',
      source: 'env'
    })
  })

  it('falls back to the preference with the exact notice on an invalid env value', () => {
    expect(resolveSegmentationMode({ JUSTSPEAK_SEGMENTED: 'loud' }, 'vad')).toEqual({
      effective: 'vad',
      source: 'preference',
      envValue: 'loud',
      envInvalid: true,
      message: 'JUSTSPEAK_SEGMENTED 的值无效（loud），已回退到设置中的「按静音分段」。'
    })
  })

  it('uses the preference when env is unset or empty', () => {
    expect(resolveSegmentationMode({}, 'single')).toEqual({
      effective: 'single',
      source: 'preference'
    })
    expect(resolveSegmentationMode({ JUSTSPEAK_SEGMENTED: '' }, 'vad')).toEqual({
      effective: 'vad',
      source: 'preference'
    })
  })

  it('formats both notices with the mode label', () => {
    expect(formatEnvTakeoverMessage('auto')).toBe(
      '当前由环境变量接管（JUSTSPEAK_SEGMENTED=auto）'
    )
    expect(formatEnvFallbackMessage('loud', 'single')).toBe(
      'JUSTSPEAK_SEGMENTED 的值无效（loud），已回退到设置中的「整段不分」。'
    )
  })

  it('does not fail the session on an invalid env value; the preference still runs', () => {
    const result = parseSegmentationConfig({ JUSTSPEAK_SEGMENTED: 'loud' }, 'single')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.mode).toBe('single')
    expect(result.resolution.envInvalid).toBe(true)
    expect(result.resolution.message).toContain('loud')
  })
})

describe('segmentation rebuild decision', () => {
  const preference = (effective: 'auto' | 'vad' | 'single') => ({
    effective,
    source: 'preference' as const
  })
  const env = (effective: 'auto' | 'vad' | 'single') => ({
    effective,
    source: 'env' as const
  })

  it('rebuilds immediately when idle with a different preference', () => {
    expect(
      shouldRebuildForSegmentation({
        resolved: preference('vad'),
        currentMode: 'auto',
        busy: false,
        initializing: false
      })
    ).toBe(true)
  })

  it('defers while recording, transcribing, or pasting', () => {
    expect(
      shouldRebuildForSegmentation({
        resolved: preference('vad'),
        currentMode: 'auto',
        busy: true,
        initializing: false
      })
    ).toBe(false)
  })

  it('defers while a provider build is already in flight', () => {
    expect(
      shouldRebuildForSegmentation({
        resolved: preference('vad'),
        currentMode: 'auto',
        busy: false,
        initializing: true
      })
    ).toBe(false)
  })

  it('never rebuilds on an env takeover or when the mode already matches', () => {
    expect(
      shouldRebuildForSegmentation({
        resolved: env('vad'),
        currentMode: 'auto',
        busy: false,
        initializing: false
      })
    ).toBe(false)
    expect(
      shouldRebuildForSegmentation({
        resolved: preference('auto'),
        currentMode: 'auto',
        busy: false,
        initializing: false
      })
    ).toBe(false)
  })
})

describe('parseSegmentationConfig', () => {
  it('defaults to auto with the segmenter defaults when no knob is set', () => {
    const result = parseSegmentationConfig({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.mode).toBe('auto')
    // `auto` and `vad` share the same knobs; with none set they resolve the same.
    const explicit = parseSegmentationConfig({ JUSTSPEAK_SEGMENTED: 'vad' })
    expect(result.config.segmenter).toEqual(explicit.ok ? explicit.config.segmenter : null)
  })

  it('fails closed in auto mode on an invalid knob, because auto may segment', () => {
    // The single-shot default used to return before reading knobs; auto can run
    // the segmenter, so a bad value must not be silently ignored.
    const result = parseSegmentationConfig({ JUSTSPEAK_VAD_START_THRESHOLD: 'not-a-number' })
    expect(result.ok).toBe(false)
  })

  it('still ignores knobs when single-shot is forced', () => {
    const result = parseSegmentationConfig({
      JUSTSPEAK_SEGMENTED: 'single',
      JUSTSPEAK_VAD_START_THRESHOLD: 'not-a-number'
    })
    // The result now also names the resolution; the one-shot config is unchanged.
    expect(result).toMatchObject({ ok: true, config: { mode: 'single', segmenter: {} } })
  })

  it('returns the resolved defaults in vad mode', () => {
    const result = parseSegmentationConfig({ JUSTSPEAK_SEGMENTED: 'vad' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.mode).toBe('vad')
    expect(result.config.segmenter).toMatchObject({
      startThreshold: DEFAULT_VAD_CONFIG.startThreshold,
      endThreshold: DEFAULT_VAD_CONFIG.endThreshold,
      minSpeechMs: DEFAULT_VAD_CONFIG.minSpeechMs,
      minSilenceMs: DEFAULT_VAD_CONFIG.minSilenceMs,
      padMs: DEFAULT_VAD_CONFIG.padMs,
      frameSamples: DEFAULT_VAD_CONFIG.frameSamples
    })
  })

  it('applies numeric overrides', () => {
    const result = parseSegmentationConfig({
      JUSTSPEAK_SEGMENTED: 'vad',
      JUSTSPEAK_VAD_START_THRESHOLD: '0.05',
      JUSTSPEAK_VAD_END_THRESHOLD: '0.01',
      JUSTSPEAK_VAD_MIN_SPEECH_MS: '300',
      JUSTSPEAK_VAD_MIN_SILENCE_MS: '450',
      JUSTSPEAK_VAD_PAD_MS: '100',
      JUSTSPEAK_VAD_FRAME_SAMPLES: '640',
      JUSTSPEAK_SEGMENT_MIN_MS: '150'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.segmenter).toMatchObject({
      startThreshold: 0.05,
      endThreshold: 0.01,
      minSpeechMs: 300,
      minSilenceMs: 450,
      padMs: 100,
      frameSamples: 640,
      minSegmentMs: 150
    })
  })

  it('rejects a non-numeric knob by name', () => {
    const result = parseSegmentationConfig({
      JUSTSPEAK_SEGMENTED: 'vad',
      JUSTSPEAK_VAD_START_THRESHOLD: 'high'
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('JUSTSPEAK_VAD_START_THRESHOLD')
  })

  it('rejects thresholds that would break the hysteresis', () => {
    const result = parseSegmentationConfig({
      JUSTSPEAK_SEGMENTED: 'vad',
      JUSTSPEAK_VAD_START_THRESHOLD: '0.01',
      JUSTSPEAK_VAD_END_THRESHOLD: '0.02'
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('VAD 配置无效')
  })

  it('rejects a negative minimum segment', () => {
    const result = parseSegmentationConfig({
      JUSTSPEAK_SEGMENTED: 'vad',
      JUSTSPEAK_SEGMENT_MIN_MS: '-1'
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('JUSTSPEAK_SEGMENT_MIN_MS')
  })
})
