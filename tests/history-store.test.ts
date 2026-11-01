import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HISTORY_FILE, HistoryStore } from '../src/main/history-store'
import type { TranscriptEvent } from '../src/shared/ipc'

const directories: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'justspeak-history-'))
  directories.push(dir)
  return dir
}

function event(text: string): TranscriptEvent {
  return { text, fake: false, durationMs: 1200, latencyMs: 300 }
}

function counterStore(dir: string): HistoryStore {
  let id = 0
  let now = new Date(2026, 10, 1, 9, 0, 0).getTime()
  return new HistoryStore(dir, {
    readFile,
    writeFile,
    mkdir,
    appendFile,
    rename,
    unlink,
    readdir,
    now: () => (now += 1000),
    newId: () => `id-${++id}`
  })
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('history store', () => {
  it('treats a missing file as an empty history', async () => {
    await expect(new HistoryStore(makeDir()).list()).resolves.toEqual([])
  })

  it('rejects instead of reporting an empty history when the file is unreadable', async () => {
    const denied = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    const store = new HistoryStore(makeDir(), {
      readFile: (async () => {
        throw denied
      }) as unknown as typeof readFile,
      writeFile,
      mkdir,
      appendFile,
      rename,
      unlink,
      readdir,
      now: Date.now,
      newId: () => 'id'
    })
    await expect(store.list()).rejects.toThrow('EACCES')
  })

  it('appends entries and returns them newest first', async () => {
    const dir = makeDir()
    const store = counterStore(dir)
    const first = await store.append(event('第一句'), 'pasted')
    const second = await store.append(event('第二句'), 'inserted')

    const listed = await store.list()
    expect(listed.map((value) => value.id)).toEqual([second.id, first.id])
    expect(listed[1]).toMatchObject({
      text: '第一句',
      outcome: 'pasted',
      fake: false,
      durationMs: 1200,
      latencyMs: 300
    })
  })

  it('writes one line per entry and survives a newline inside the text', async () => {
    const dir = makeDir()
    const store = counterStore(dir)
    await store.append(event('第一段\n第二段'), 'pasted')
    const raw = readFileSync(path.join(dir, 'history', HISTORY_FILE), 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(1)
    expect((await store.list())[0]?.text).toBe('第一段\n第二段')
  })

  it('serialises concurrent appends instead of losing one', async () => {
    const dir = makeDir()
    const store = counterStore(dir)
    await Promise.all([
      store.append(event('a'), 'pasted'),
      store.append(event('b'), 'pasted'),
      store.append(event('c'), 'pasted')
    ])
    expect(await store.list()).toHaveLength(3)
  })

  it('removes one entry and rewrites the file', async () => {
    const dir = makeDir()
    const store = counterStore(dir)
    const first = await store.append(event('保留'), 'pasted')
    const second = await store.append(event('删除'), 'pasted')

    const remaining = await store.remove(second.id)
    expect(remaining.map((value) => value.id)).toEqual([first.id])
    expect(await store.list()).toHaveLength(1)
  })

  it('keeps the rest of the file when one line is corrupt', async () => {
    const dir = makeDir()
    const store = counterStore(dir)
    await store.append(event('好的'), 'pasted')
    const file = path.join(dir, 'history', HISTORY_FILE)
    const { appendFileSync } = await import('node:fs')
    appendFileSync(file, '{broken\n')

    const listed = await store.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.text).toBe('好的')
  })

  it('saves the recording as a WAV next to the entry', async () => {
    const dir = makeDir()
    const store = counterStore(dir)
    const pcm = Int16Array.from([0, 100, -100, 200])
    const entry = await store.append(event('带音频'), 'pasted', { pcm, sampleRate: 16000 })

    expect(entry.audio?.file).toBe(`audio/${entry.id}.wav`)
    expect(entry.audio?.bytes).toBe(44 + pcm.length * 2)
    const bytes = new Uint8Array(
      readFileSync(path.join(dir, 'history', entry.audio?.file ?? ''))
    )
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF')

    const returned = await store.readAudio(entry.id)
    expect(returned).not.toBeNull()
    expect(new Uint8Array(returned as ArrayBuffer).byteLength).toBe(entry.audio?.bytes)
  })

  it('removes the audio file together with its row', async () => {
    const dir = makeDir()
    const store = counterStore(dir)
    const entry = await store.append(event('删除我'), 'pasted', {
      pcm: Int16Array.from([1, 2, 3]),
      sampleRate: 16000
    })
    const audioFile = path.join(dir, 'history', entry.audio?.file ?? '')

    await store.remove(entry.id)
    expect(() => readFileSync(audioFile)).toThrow()
    await expect(store.readAudio(entry.id)).resolves.toBeNull()
  })

  it('sweeps entries older than the retention window and their audio', async () => {
    const dir = makeDir()
    const store = counterStore(dir)
    const entry = await store.append(event('旧记录'), 'pasted', {
      pcm: Int16Array.from([1, 2, 3]),
      sampleRate: 16000
    })
    const audioFile = path.join(dir, 'history', entry.audio?.file ?? '')

    await store.sweep(new Date(2026, 11, 1, 12).getTime())
    await expect(store.list()).resolves.toEqual([])
    expect(() => readFileSync(audioFile)).toThrow()
  })

  it('deletes a stale rewrite temp file on sweep', async () => {
    const dir = makeDir()
    const store = counterStore(dir)
    await store.append(event('有记录'), 'pasted')
    const stale = path.join(dir, 'history', `${HISTORY_FILE}.123.tmp`)
    writeFileSync(stale, 'half a rewrite')

    await store.sweep()
    expect(() => readFileSync(stale)).toThrow()
  })

  it('deletes an orphan WAV that no entry references', async () => {
    const dir = makeDir()
    const store = counterStore(dir)
    await store.append(event('有记录'), 'pasted')
    const orphan = path.join(dir, 'history', 'audio', 'orphan.wav')
    mkdirSync(path.dirname(orphan), { recursive: true })
    writeFileSync(orphan, 'not a real wav')

    await store.sweep()
    expect(() => readFileSync(orphan)).toThrow()
  })
})
