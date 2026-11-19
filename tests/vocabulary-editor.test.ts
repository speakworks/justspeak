import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  importReplacementLines,
  importTermLines,
  normalizeVocabularySavePayload,
  parseTermList,
  parseVocabularyConfig,
  planStarterLoad
} from '../src/core/postprocess'
import { describeVocabulary } from '../src/core/preferences/view'
import {
  VOCABULARY_FILE,
  VocabularyStore,
  type VocabularyStoreDeps
} from '../src/main/vocabulary-store'
import {
  createSaveQueue,
  saveVocabularyPayload,
  type VocabularySaveStore
} from '../src/main/vocabulary-save'
import { STARTER_VOCABULARY_TERMS } from '../src/main/vocabulary-starter'
import type { VocabularySummary } from '../src/shared/ipc'

const EXPECTED_STARTER = [
  'JustSpeak',
  'Claude Code',
  '豆包',
  '飞书',
  'GitHub',
  'OpenSpec',
  'Electron',
  '网易云音乐',
  '腾讯音乐人',
  '汽水音乐'
]

const directories: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-vocabulary-editor-'))
  directories.push(dir)
  return dir
}

function vocabularyFile(dir: string): string {
  return path.join(dir, VOCABULARY_FILE)
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('batch term import', () => {
  it('imports nothing from empty or all-blank text', () => {
    expect(importTermLines('')).toEqual({ entries: [], duplicates: 0, invalidLines: 0 })
    expect(importTermLines('\n  \n\t\r\n')).toEqual({
      entries: [],
      duplicates: 0,
      invalidLines: 0
    })
  })

  it('trims, skips blank lines, and de-duplicates exactly keeping the first', () => {
    const result = importTermLines(' Kubernetes \n\nKubernetes\n  GPT-4o  \n')
    expect(result.entries).toEqual(['Kubernetes', 'GPT-4o'])
    expect(result.duplicates).toBe(1)
    expect(result.invalidLines).toBe(0)
  })

  it('keeps mixed CJK and ASCII entries without rewriting them', () => {
    const result = importTermLines('张三\nKubernetes\n李四\nGPT-4o')
    expect(result.entries).toEqual(['张三', 'Kubernetes', '李四', 'GPT-4o'])
    expect(result.duplicates).toBe(0)
  })

  it('holds more drafts than the decode-time cap and lets the parser cap the save', () => {
    const input = Array.from({ length: 40 }, (_, index) => `term-${index}`).join('\n')
    const result = importTermLines(input)
    expect(result.entries).toHaveLength(40)
    const parsed = parseTermList(result.entries)
    expect(parsed.terms).toHaveLength(32)
    expect(parsed.terms[31]).toBe('term-31')
    expect(parsed.droppedByCap).toBe(8)
  })

  it('keeps a comma term as a draft and lets the existing parser discard it', () => {
    const result = importTermLines('Kubernetes\nDoe, Jane\nGPT-4o')
    expect(result.entries).toEqual(['Kubernetes', 'Doe, Jane', 'GPT-4o'])
    const parsed = parseTermList(result.entries)
    expect(parsed.terms).toEqual(['Kubernetes', 'GPT-4o'])
    expect(parsed.droppedByComma).toBe(1)
  })
})

describe('batch replacement import', () => {
  it('trims both sides and parses the arrow', () => {
    const result = importReplacementLines('  库贝内特斯   =>   Kubernetes   ')
    expect(result.entries).toEqual([{ from: '库贝内特斯', to: 'Kubernetes' }])
    expect(result.invalidLines).toBe(0)
    expect(result.duplicates).toBe(0)
  })

  it('counts a line without an arrow as invalid instead of dropping it silently', () => {
    const result = importReplacementLines('库贝内特斯 => Kubernetes\nbroken line')
    expect(result.entries).toEqual([{ from: '库贝内特斯', to: 'Kubernetes' }])
    expect(result.invalidLines).toBe(1)
  })

  it('counts an empty side as invalid', () => {
    const result = importReplacementLines('=> Kubernetes\n库贝内特斯 =>\nKubernetes => 库贝内特斯')
    expect(result.entries).toEqual([{ from: 'Kubernetes', to: '库贝内特斯' }])
    expect(result.invalidLines).toBe(2)
  })

  it('de-duplicates by from and keeps the first occurrence', () => {
    const result = importReplacementLines(
      '库贝内特斯 => Kubernetes\n库贝内特斯 => K8s\nGPT-4o => GPT4o'
    )
    expect(result.entries).toEqual([
      { from: '库贝内特斯', to: 'Kubernetes' },
      { from: 'GPT-4o', to: 'GPT4o' }
    ])
    expect(result.duplicates).toBe(1)
  })

  it('skips blank lines without counting them as invalid', () => {
    const result = importReplacementLines('\n  \n库贝内特斯 => Kubernetes\n\n')
    expect(result.entries).toEqual([{ from: '库贝内特斯', to: 'Kubernetes' }])
    expect(result.invalidLines).toBe(0)
    expect(result.duplicates).toBe(0)
  })
})

describe('save payload normalisation', () => {
  it('produces exactly what the file parser produces from the same lists', () => {
    const raw = {
      terms: [' Kubernetes ', 'Kubernetes', 'Doe, Jane', '', 'GPT-4o'],
      replace: [
        { from: '库贝内特斯', to: 'Kubernetes' },
        { from: '', to: 'x' },
        { from: 'x', to: '' }
      ],
      protect: ['JustSpeak', 'JustSpeak', '  ', 'FD2008']
    }
    expect(normalizeVocabularySavePayload(raw)).toEqual(parseVocabularyConfig(raw))
    expect(normalizeVocabularySavePayload(raw).terms).toEqual(['Kubernetes', 'GPT-4o'])
    expect(normalizeVocabularySavePayload(raw).vocabulary).toEqual({
      replace: [{ from: '库贝内特斯', to: 'Kubernetes' }],
      protect: ['JustSpeak', 'FD2008']
    })
  })

  it('caps a payload above 32 terms through parseTermList', () => {
    const raw = { terms: Array.from({ length: 40 }, (_, i) => `term-${i}`), replace: [], protect: [] }
    expect(normalizeVocabularySavePayload(raw).terms).toHaveLength(32)
  })

  it('resolves a non-object payload to empty options without throwing', () => {
    expect(normalizeVocabularySavePayload(null)).toEqual({})
    expect(normalizeVocabularySavePayload('nope')).toEqual({})
  })
})

describe('atomic vocabulary save', () => {
  it('writes through a temporary file and leaves only the target behind', async () => {
    const dir = makeDir()
    const store = new VocabularyStore(dir)
    await store.save({
      terms: ['Kubernetes'],
      vocabulary: { replace: [{ from: '库贝内特斯', to: 'Kubernetes' }], protect: ['JustSpeak'] }
    })
    expect(await readdir(dir)).toEqual([VOCABULARY_FILE])
    await expect(store.load()).resolves.toMatchObject({
      terms: ['Kubernetes'],
      vocabulary: { replace: [{ from: '库贝内特斯', to: 'Kubernetes' }] }
    })
  })

  it('leaves the original file untouched when the write fails and removes the temporary file', async () => {
    const dir = makeDir()
    const original = JSON.stringify({ terms: ['Kubernetes'], replace: [], protect: [] }, null, 2)
    await writeFile(vocabularyFile(dir), original, 'utf8')

    const failure = new Error('disk full')
    // Write a real partial temporary file first, then fail mid-write, so this
    // exercises the cleanup path rather than a write that never started.
    const partialWrite = (async (...args: Parameters<typeof writeFile>) => {
      await writeFile(args[0], typeof args[1] === 'string' ? args[1].slice(0, 12) : args[1])
      throw failure
    }) as typeof writeFile
    const deps: VocabularyStoreDeps = {
      readFile,
      writeFile: partialWrite,
      mkdir,
      rename,
      unlink
    }
    const store = new VocabularyStore(dir, deps)
    await expect(store.save({ terms: ['GPT-4o'] })).rejects.toThrow('disk full')
    expect(await readFile(vocabularyFile(dir), 'utf8')).toBe(original)
    // The partial temporary file was written and then unlinked.
    expect(await readdir(dir)).toEqual([VOCABULARY_FILE])
  })

  it('leaves the original file untouched when rename fails and removes the temporary file', async () => {
    const dir = makeDir()
    const original = JSON.stringify({ terms: ['Kubernetes'], replace: [], protect: [] }, null, 2)
    await writeFile(vocabularyFile(dir), original, 'utf8')

    const deps: VocabularyStoreDeps = {
      readFile,
      writeFile,
      mkdir,
      rename: async () => {
        throw new Error('rename failed')
      },
      unlink
    }
    const store = new VocabularyStore(dir, deps)
    await expect(store.save({ terms: ['GPT-4o'] })).rejects.toThrow('rename failed')
    expect(await readFile(vocabularyFile(dir), 'utf8')).toBe(original)
    // The temporary file was written and then unlinked.
    expect(await readdir(dir)).toEqual([VOCABULARY_FILE])
  })
})

describe('save and read-back', () => {
  it('returns the read-back options the next dictation uses', async () => {
    const dir = makeDir()
    const store = new VocabularyStore(dir)
    const outcome = await saveVocabularyPayload(store, {
      terms: ['Kubernetes', 'GPT-4o'],
      replace: [{ from: '库贝内特斯', to: 'Kubernetes' }],
      protect: ['JustSpeak']
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.options.terms).toEqual(['Kubernetes', 'GPT-4o'])
    expect(outcome.load.state).toBe('loaded')
    // A fresh store (the next session) reads the same term list.
    await expect(new VocabularyStore(dir).load()).resolves.toMatchObject({
      terms: ['Kubernetes', 'GPT-4o']
    })
  })

  it('writes three empty arrays for an empty save', async () => {
    const dir = makeDir()
    const outcome = await saveVocabularyPayload(new VocabularyStore(dir), {
      terms: [],
      replace: [],
      protect: []
    })
    expect(outcome.ok).toBe(true)
    expect(JSON.parse(await readFile(vocabularyFile(dir), 'utf8'))).toEqual({
      terms: [],
      replace: [],
      protect: []
    })
  })

  it('keeps replacements and protects for an old file without terms', async () => {
    const dir = makeDir()
    await writeFile(
      vocabularyFile(dir),
      JSON.stringify({
        replace: [{ from: '库贝内特斯', to: 'Kubernetes' }],
        protect: ['JustSpeak']
      }),
      'utf8'
    )
    const store = new VocabularyStore(dir)
    const loaded = await store.loadDetailed()
    expect(loaded.options.terms).toEqual([])

    const outcome = await saveVocabularyPayload(store, {
      terms: loaded.options.terms ?? [],
      replace: loaded.options.vocabulary?.replace ?? [],
      protect: loaded.options.vocabulary?.protect ?? []
    })
    expect(outcome.ok).toBe(true)
    expect(JSON.parse(await readFile(vocabularyFile(dir), 'utf8'))).toEqual({
      terms: [],
      replace: [{ from: '库贝内特斯', to: 'Kubernetes' }],
      protect: ['JustSpeak']
    })
  })

  it('preserves rules and repetitionThreshold from the file while the payload owns the lists', async () => {
    const dir = makeDir()
    await writeFile(
      vocabularyFile(dir),
      JSON.stringify({
        terms: ['Old'],
        replace: [],
        protect: [],
        rules: { filler: false },
        repetitionThreshold: 5
      }),
      'utf8'
    )
    const store = new VocabularyStore(dir)
    const outcome = await saveVocabularyPayload(store, {
      terms: ['Kubernetes', 'GPT-4o'],
      replace: [{ from: '库贝内特斯', to: 'Kubernetes' }],
      protect: ['JustSpeak']
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.options.rules).toEqual({ filler: false })
    expect(outcome.options.repetitionThreshold).toBe(5)

    const written = JSON.parse(await readFile(vocabularyFile(dir), 'utf8'))
    expect(written.rules).toEqual({ filler: false })
    expect(written.repetitionThreshold).toBe(5)
    // The payload still replaces all three lists.
    expect(written.terms).toEqual(['Kubernetes', 'GPT-4o'])
    expect(written.replace).toEqual([{ from: '库贝内特斯', to: 'Kubernetes' }])
    expect(written.protect).toEqual(['JustSpeak'])
  })

  it('repairs an unreadable file with a fresh valid save', async () => {
    const dir = makeDir()
    await writeFile(vocabularyFile(dir), '{ not json', 'utf8')
    const store = new VocabularyStore(dir)
    await expect(store.loadDetailed()).resolves.toMatchObject({ state: 'unreadable' })

    const outcome = await saveVocabularyPayload(store, {
      terms: ['Kubernetes'],
      replace: [],
      protect: []
    })
    expect(outcome.ok).toBe(true)
    await expect(store.loadDetailed()).resolves.toMatchObject({
      state: 'loaded',
      options: { terms: ['Kubernetes'] }
    })
  })

  it('drops a comma term through the existing parser and reports success on the rest', async () => {
    const dir = makeDir()
    const outcome = await saveVocabularyPayload(new VocabularyStore(dir), {
      terms: ['Kubernetes', 'Doe, Jane'],
      replace: [],
      protect: []
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.options.terms).toEqual(['Kubernetes'])
    expect(JSON.parse(await readFile(vocabularyFile(dir), 'utf8')).terms).toEqual(['Kubernetes'])
  })

  it('rejects a malformed payload without writing', async () => {
    const dir = makeDir()
    const store = new VocabularyStore(dir)
    for (const payload of [null, {}, { terms: 'x', replace: [], protect: [] }]) {
      await expect(saveVocabularyPayload(store, payload)).resolves.toMatchObject({ ok: false })
    }
    expect(await readdir(dir)).toEqual([])
  })

  it('reports a store failure and returns no options', async () => {
    const store: VocabularySaveStore = {
      save: async () => {
        throw new Error('read-only volume')
      },
      // The save path reads the current file first to preserve rule settings.
      loadDetailed: async () => ({
        options: {},
        state: 'default',
        termList: {
          terms: [],
          droppedByComma: 0,
          droppedByCap: 0,
          droppedByInvalid: 0,
          droppedTermCount: 0
        }
      })
    }
    const outcome = await saveVocabularyPayload(store, {
      terms: ['Kubernetes'],
      replace: [],
      protect: []
    })
    expect(outcome.ok).toBe(false)
    expect(outcome).not.toHaveProperty('options')
    if (outcome.ok) return
    expect(outcome.message).toContain('保存词汇表失败')
    expect(outcome.message).toContain('read-only volume')
  })

  it('reports a read-back failure instead of claiming the save worked', async () => {
    const store: VocabularySaveStore = {
      save: async () => undefined,
      loadDetailed: async () => ({
        options: {},
        state: 'unreadable',
        termList: {
          terms: [],
          droppedByComma: 0,
          droppedByCap: 0,
          droppedByInvalid: 0,
          droppedTermCount: 0
        },
        message: '词汇表文件不是有效的 JSON。'
      })
    }
    const outcome = await saveVocabularyPayload(store, {
      terms: [],
      replace: [],
      protect: []
    })
    expect(outcome).toMatchObject({ ok: false, message: '词汇表文件不是有效的 JSON。' })
  })
})

describe('starter vocabulary', () => {
  it('is valid JSON with exactly the ten expected terms and no ASCII comma', async () => {
    const raw = JSON.parse(
      await readFile(new URL('../resources/vocabulary-starter.json', import.meta.url), 'utf8')
    )
    expect(raw).toEqual({ terms: EXPECTED_STARTER, replace: [], protect: [] })
    expect(raw.terms).toHaveLength(10)
    expect(raw.terms.every((term: string) => !term.includes(','))).toBe(true)
  })

  it('imports the resource as the single source used by main', () => {
    expect(STARTER_VOCABULARY_TERMS).toEqual(EXPECTED_STARTER)
    expect(STARTER_VOCABULARY_TERMS).toHaveLength(10)
  })

  it('loads all ten into an empty list and is idempotent on the second call', () => {
    const first = planStarterLoad([], EXPECTED_STARTER)
    expect(first).toEqual({ terms: EXPECTED_STARTER, added: 10, excludedByCap: 0, complete: false })

    const second = planStarterLoad(first.terms, EXPECTED_STARTER)
    expect(second).toEqual({ terms: EXPECTED_STARTER, added: 0, excludedByCap: 0, complete: true })
  })

  it('keeps existing terms first and appends only the missing starter entries', () => {
    const plan = planStarterLoad(['豆包', 'GitHub', 'Kubernetes'], EXPECTED_STARTER)
    expect(plan.terms).toEqual([
      '豆包',
      'GitHub',
      'Kubernetes',
      'JustSpeak',
      'Claude Code',
      '飞书',
      'OpenSpec',
      'Electron',
      '网易云音乐',
      '腾讯音乐人',
      '汽水音乐'
    ])
    expect(plan.added).toBe(8)
    expect(plan.excludedByCap).toBe(0)
    expect(plan.complete).toBe(false)
  })

  it('reports complete without a write when every starter term is present', async () => {
    const existing = ['Kubernetes', ...EXPECTED_STARTER]
    const plan = planStarterLoad(existing, EXPECTED_STARTER)
    expect(plan.complete).toBe(true)
    expect(plan.added).toBe(0)
    expect(plan.excludedByCap).toBe(0)
    expect(plan.terms).toEqual(existing)

    // The renderer guard: a complete plan skips the save call entirely.
    let writes = 0
    const persist = async (): Promise<void> => {
      writes += 1
    }
    if (!plan.complete) await persist()
    expect(writes).toBe(0)
  })

  it('treats trimmed entries as already present', () => {
    const plan = planStarterLoad([' Kubernetes ', '豆包 '], ['Kubernetes', '豆包'])
    expect(plan).toEqual({
      terms: ['Kubernetes', '豆包'],
      added: 0,
      excludedByCap: 0,
      complete: true
    })
  })

  it('saves the merged list through the normal path and reports the read-back count', async () => {
    const dir = makeDir()
    const store = new VocabularyStore(dir)
    const plan = planStarterLoad(['Kubernetes'], EXPECTED_STARTER)
    const outcome = await saveVocabularyPayload(store, {
      terms: plan.terms,
      replace: [],
      protect: []
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.options.terms).toHaveLength(11)
    expect(outcome.options.terms?.[0]).toBe('Kubernetes')
    expect(outcome.load.termList.terms).toHaveLength(11)
    await expect(store.load()).resolves.toMatchObject({
      terms: ['Kubernetes', ...EXPECTED_STARTER]
    })
  })

  it('caps a merged load at 32 and reports the starter terms that did not fit', async () => {
    const dir = makeDir()
    const store = new VocabularyStore(dir)
    const existing = Array.from({ length: 25 }, (_, index) => `term-${index}`)
    const plan = planStarterLoad(existing, EXPECTED_STARTER)
    expect(plan.terms).toHaveLength(32)
    expect(plan.added).toBe(7)
    expect(plan.excludedByCap).toBe(3)
    expect(plan.complete).toBe(false)

    const outcome = await saveVocabularyPayload(store, {
      terms: plan.terms,
      replace: [],
      protect: []
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    // Read-back confirms the same 32 entries; the overflow was capped before
    // the write, so the file itself never holds a dropped tail.
    expect(outcome.load.termList.terms).toEqual(plan.terms)
    expect(outcome.load.termList.droppedByCap).toBe(0)
    expect(JSON.parse(await readFile(vocabularyFile(dir), 'utf8')).terms).toHaveLength(32)
  })

  it('writes no starter term when the list is already at the cap and states the overflow', () => {
    const existing = Array.from({ length: 32 }, (_, index) => `term-${index}`)
    const plan = planStarterLoad(existing, EXPECTED_STARTER)
    expect(plan.added).toBe(0)
    expect(plan.excludedByCap).toBe(EXPECTED_STARTER.length)
    expect(plan.complete).toBe(false)
    expect(plan.terms).toEqual(existing)
  })

  it('does not write when all ten starter terms already fit in the cap', () => {
    const existing = [
      ...EXPECTED_STARTER,
      ...Array.from({ length: 22 }, (_, index) => `term-${index}`)
    ]
    const plan = planStarterLoad(existing, EXPECTED_STARTER)
    expect(plan.complete).toBe(true)
    expect(plan.added).toBe(0)
    expect(plan.excludedByCap).toBe(0)
    expect(plan.terms).toEqual(existing)
  })

  it('reports the over-cap tail from a hand-edited file on read-back', async () => {
    const dir = makeDir()
    const terms = Array.from({ length: 35 }, (_, index) => `term-${index}`)
    await writeFile(
      vocabularyFile(dir),
      JSON.stringify({ terms, replace: [], protect: [] }),
      'utf8'
    )
    const loaded = await new VocabularyStore(dir).loadDetailed()
    expect(loaded.termList.terms).toHaveLength(32)
    expect(loaded.termList.droppedByCap).toBe(3)
  })
})

describe('vocabulary view copy', () => {
  const LOADED: VocabularySummary = {
    path: '/tmp/userData/vocabulary.json',
    state: 'loaded',
    termCount: 2,
    replaceCount: 1,
    protectCount: 1,
    droppedTermCount: 0,
    droppedByCapCount: 0,
    providerSupportsTerms: true,
    terms: ['Kubernetes', 'GPT-4o'],
    replace: [{ from: '库贝内特斯', to: 'Kubernetes' }],
    protect: ['JustSpeak'],
    starterTerms: []
  }

  it('keeps the existing loaded copy without naming the entries', () => {
    expect(describeVocabulary(LOADED)).toEqual({
      status: 'override',
      statusLabel: '已修改',
      detail: '已加载 术语 2 条 / 替换 1 条 / 保护 1 条。'
    })
  })

  it('keeps an explicit reason for an unreadable file', () => {
    expect(
      describeVocabulary({ ...LOADED, state: 'unreadable', message: '词汇表文件不是有效的 JSON。' })
    ).toMatchObject({
      status: 'unavailable',
      detail: '词汇表文件不是有效的 JSON。'
    })
  })
})

describe('vocabulary save queue', () => {
  it('runs overlapping tasks one at a time in call order', async () => {
    const enqueue = createSaveQueue()
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = enqueue(async () => {
      order.push('first-start')
      await gate
      order.push('first-end')
      return 1
    })
    const second = enqueue(async () => {
      order.push('second-start')
      order.push('second-end')
      return 2
    })

    await Promise.resolve()
    // The second task cannot start while the first is still in flight.
    expect(order).toEqual(['first-start'])
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2])
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end'])
  })

  it('keeps accepting tasks after a rejected one', async () => {
    const enqueue = createSaveQueue()
    await expect(
      enqueue(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    await expect(enqueue(async () => 'ok')).resolves.toBe('ok')
  })
})
