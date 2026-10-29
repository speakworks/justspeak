import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (relative: string): string => readFileSync(path.join(ROOT, relative), 'utf8')

/**
 * The docs corrected by this branch must describe the shipped v0.1 path, not
 * the rejected or aspirational one. These assertions pin the specific stale
 * claims so a later edit cannot quietly reintroduce them.
 */
describe('architecture docs match the shipped v0.1 path', () => {
  it('names the shipped local ASR runtime instead of the abandoned candidates', () => {
    const architecture = read('docs/ARCHITECTURE.md')
    expect(architecture).toContain('transcribe-cli')
    expect(architecture).not.toContain('whisper.cpp / sherpa-onnx')
  })

  it('does not assign shipped text injection or resampling to the helper or core', () => {
    const pipeline = read('docs/AUDIO-PIPELINE.md')
    expect(pipeline).not.toMatch(/text injection, permission status/)
    expect(pipeline).not.toMatch(/owner of VAD, resampling/)
    expect(pipeline).not.toContain('`startCapture`')
    expect(pipeline).not.toContain('follow-up docs card to amend ARCHITECTURE.md')
  })
})
