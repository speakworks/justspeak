/**
 * Runs the hidden-window TTS probe and classifies its payload.
 *
 * The Electron side (`tts-probe.cjs`) only reports what it observed; whether
 * that observation counts as a first-packet measurement is decided here by
 * `classifyTtsProbe`, which rejects a voice-less run rather than reporting a
 * spectacular latency from callbacks that never made sound.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { classifyTtsProbe, type SegmentResult, blockedSegment } from './report'

export interface TtsProbeOptions {
  electronBinary: string
  probePath: string
  cwd: string
  samples: number
  text: string
  /** Whole-probe timeout; a single utterance may take up to 15 s inside it. */
  timeoutMs?: number
}

export interface TtsProbePayload {
  startMs: number[]
  boundaryMs: number[]
  errors: string[]
  voiceCount: number
  zhVoice: string | null
}

/** Electron as installed by this repository; null-safe when dependencies are absent. */
export function electronBinaryPath(root: string): string {
  return path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
}

export async function probeTts(options: TtsProbeOptions): Promise<SegmentResult> {
  if (!existsSync(options.electronBinary)) {
    return blockedSegment(
      `Electron 不存在：${path.relative(options.cwd, options.electronBinary)}（需先安装依赖）`
    )
  }
  if (!existsSync(options.probePath)) {
    return blockedSegment(
      `TTS 探针脚本不存在：${path.relative(options.cwd, options.probePath)}`
    )
  }
  const payload = await runProbe(options)
  if ('spawnError' in payload) return blockedSegment(payload.spawnError)
  if (payload.startMs.length > 0 && payload.startMs.length < options.samples) {
    console.warn(
      `[latency] tts: 只拿到 ${payload.startMs.length}/${options.samples} 次样本，按实际次数统计`
    )
  }
  return classifyTtsProbe(payload, options.samples)
}

type ProbeOutcome = TtsProbePayload | { spawnError: string }

function runProbe(options: TtsProbeOptions): Promise<ProbeOutcome> {
  const timeoutMs = options.timeoutMs ?? 180_000
  return new Promise<ProbeOutcome>((resolve) => {
    const child = spawn(
      options.electronBinary,
      [
        options.probePath,
        '--samples',
        String(options.samples),
        '--text',
        options.text
      ],
      { cwd: options.cwd, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let stdout = ''
    let stderr = ''
    let settled = false
    const settle = (outcome: ProbeOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      settle({ spawnError: `探针超过 ${Math.round(timeoutMs / 1000)} 秒未返回（请求 ${options.samples} 次）` })
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => settle({ spawnError: error.message }))
    child.on('close', () => {
      const line = stdout.split('\n').find((value) => value.startsWith('HARNESS_RESULT '))
      if (!line) {
        settle({ spawnError: `探针无结果输出：${stderr.slice(-300) || '(空)'}` })
        return
      }
      try {
        settle(JSON.parse(line.slice('HARNESS_RESULT '.length)) as TtsProbePayload)
      } catch (error) {
        settle({
          spawnError: `探针结果无法解析：${error instanceof Error ? error.message : String(error)}`
        })
      }
    })
  })
}
