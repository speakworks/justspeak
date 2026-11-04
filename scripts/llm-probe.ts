/**
 * LLM sidecar spike probe.
 *
 *   node --import tsx scripts/llm-probe.ts --model /path/to/model.gguf
 *
 * Starts llama-server as a child, asks it to classify correction markers,
 * records cold-start, RSS, and decision latency, then stops the sidecar. This
 * is a measurement tool, not product code: nothing in the app imports it.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LlamaSidecar } from '../src/main/llm/sidecar'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

function arg(name: string, fallback?: string): string | undefined {
  const index = args.indexOf(`--${name}`)
  if (index >= 0 && args[index + 1]) return args[index + 1]
  return fallback
}

const binary = path.resolve(
  ROOT,
  arg('binary', 'models/runtime/llama.cpp/build/bin/llama-server') as string
)
const model = arg('model', process.env.JUSTSPEAK_LLM_MODEL)
const requestedRuns = Number(arg('runs', '3'))
if (!Number.isInteger(requestedRuns) || requestedRuns < 1) {
  console.error('llm-probe: --runs must be a positive integer')
  process.exit(1)
}
const runs = requestedRuns

if (!model) {
  console.error('llm-probe: pass --model /path/to/model.gguf (or JUSTSPEAK_LLM_MODEL)')
  process.exit(1)
}
const modelPath = model as string

const cases = [
  '他说……不对，走了',
  '周一发，不对，周二发。',
  '这个不对。',
  '我们明天下午三点开会，不对，是四点。',
  '我觉得这个方案可以，no wait，还是下周吧。'
]

function rssKb(pid: number | undefined): number | undefined {
  if (pid === undefined) return undefined
  const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' })
  const value = Number(result.stdout.trim())
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/** Nearest-rank percentile: P50 of 10 samples is the 5th value, not the 6th. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]
}

async function main(): Promise<void> {
  const sidecar = new LlamaSidecar({
    binaryPath: binary,
    modelPath,
    onLog: (line) => {
      if (/error|failed|exited/i.test(line)) console.error(line)
    }
  })

  try {
    const started = Date.now()
    await sidecar.start()
    const startupMs = Date.now() - started
    const rssAfterLoad = rssKb(sidecar.pid)

    const measurements: Array<{
      input: string
      action: string
      latencyMs: number
      raw: string
      timedOut: boolean
    }> = []
    for (let run = 0; run < runs; run += 1) {
      for (const input of cases) {
        const result = await sidecar.decide(input, 800)
        measurements.push({
          input,
          action: result.action,
          latencyMs: result.latencyMs,
          raw: result.raw,
          timedOut: result.timedOut
        })
        console.log(
          JSON.stringify({
            run: run + 1,
            input,
            action: result.action,
            latency_ms: result.latencyMs,
            timed_out: result.timedOut,
            raw: result.raw.slice(0, 120)
          })
        )
      }
    }

    const latencies = measurements.map((measurement) => measurement.latencyMs)
    console.log(
      JSON.stringify({
        summary: true,
        startup_ms: startupMs,
        rss_mb: rssAfterLoad === undefined ? undefined : Math.round(rssAfterLoad / 1024),
        threads: sidecar.threads,
        requests: measurements.length,
        p50_ms: percentile(latencies, 50),
        p95_ms: percentile(latencies, 95),
        max_ms: Math.max(...latencies),
        timeouts: measurements.filter((measurement) => measurement.timedOut).length,
        deferrals: measurements.filter((measurement) => measurement.action === 'defer_to_human')
          .length
      })
    )
  } finally {
    await sidecar.stop()
  }
}

main().catch((error) => {
  console.error(`llm-probe: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
