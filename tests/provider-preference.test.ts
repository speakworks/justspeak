import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProviderPreferenceStore } from '../src/main/asr/provider-preference'
import { resolveAsrMode } from '../src/main/asr/mode'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'justspeak-asr-pref-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('ASR provider preference', () => {
  it('returns undefined on first run so selection falls back to qwen3', async () => {
    const store = new ProviderPreferenceStore(dir)
    expect(await store.load()).toBeUndefined()
    expect(resolveAsrMode({ preference: await store.load() })).toEqual({
      ok: true,
      mode: 'qwen3'
    })
  })

  it('round-trips a selectable provider', async () => {
    const store = new ProviderPreferenceStore(dir)
    await store.save('sensevoice')
    expect(await store.load()).toBe('sensevoice')
    expect(JSON.parse(await readFile(path.join(dir, 'asr-preference.json'), 'utf8'))).toEqual({
      provider: 'sensevoice'
    })
  })

  it('does not throw on a corrupt file and falls back to the default', async () => {
    await writeFile(path.join(dir, 'asr-preference.json'), '{not json', 'utf8')
    expect(await new ProviderPreferenceStore(dir).load()).toBeUndefined()
  })

  it('surfaces an unknown persisted id to the explicit selection check', async () => {
    await writeFile(
      path.join(dir, 'asr-preference.json'),
      JSON.stringify({ provider: 'cloud' }),
      'utf8'
    )
    const stored = await new ProviderPreferenceStore(dir).load()
    expect(stored).toBe('cloud')
    const selection = resolveAsrMode({ preference: stored })
    expect(selection.ok).toBe(false)
  })
})
