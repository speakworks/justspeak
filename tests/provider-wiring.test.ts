import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SELECTABLE_ASR_PROVIDER_IDS } from '../src/shared/ipc'
import { downloadFailureHint } from '../src/main/asr/download-hint'
import { isSelectableAsrMode } from '../src/main/asr/mode'
import { ASR_PROVIDER_FACTORIES } from '../src/main/asr/providers'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

describe('provider wiring', () => {
  it('registers exactly one factory for every selectable provider', () => {
    expect(Object.keys(ASR_PROVIDER_FACTORIES).sort()).toEqual(
      [...SELECTABLE_ASR_PROVIDER_IDS].sort()
    )
  })

  it('accepts every selectable provider id and rejects non-selectable ones', () => {
    for (const id of SELECTABLE_ASR_PROVIDER_IDS) {
      expect(isSelectableAsrMode(id), id).toBe(true)
    }
    expect(isSelectableAsrMode('fake')).toBe(false)
    expect(isSelectableAsrMode('cloud')).toBe(false)
    expect(isSelectableAsrMode(undefined)).toBe(false)
  })

  it('gives a download-failure remedy that matches the provider', () => {
    const qwen3 = downloadFailureHint('qwen3', 'Qwen3-ASR 0.6B (Q8_0)', '/models/qwen3.gguf')
    expect(qwen3).toContain('pnpm setup:asr')

    const sensevoice = downloadFailureHint(
      'sensevoice',
      'SenseVoice Small (Q8_0)',
      '/models/sensevoice.gguf'
    )
    expect(sensevoice).not.toContain('Qwen3')
    expect(sensevoice).toContain('/models/sensevoice.gguf')
  })

  it('documents every selectable provider and the preference file in the README', () => {
    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8')
    for (const id of SELECTABLE_ASR_PROVIDER_IDS) {
      expect(readme, `README must document JUSTSPEAK_ASR=${id}`).toContain(
        `JUSTSPEAK_ASR=${id}`
      )
    }
    expect(readme).toContain('asr-preference.json')
    expect(readme).toContain('JUSTSPEAK_SENSEVOICE_MODEL')
  })
})
