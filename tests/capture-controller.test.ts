import { describe, expect, it, vi } from 'vitest'
import {
  CAPTURE_CANCELLED_MESSAGE,
  CAPTURE_MODULE_FAILED_MESSAGE,
  CAPTURE_NOTHING_TO_STOP_MESSAGE,
  CAPTURE_SAMPLE_RATE_MESSAGE,
  CAPTURE_START_RETRY_MESSAGE,
  CaptureController,
  type AudioContextPort,
  type CaptureControllerPorts,
  type CaptureStreamPort,
  type WorkletNodePort
} from '../src/core/capture/capture-controller'
import type { PcmBatch, RecordingSummary } from '../src/shared/ipc'

interface HarnessOptions {
  sampleRate?: number
  userMedia?: () => Promise<CaptureStreamPort>
  addModule?: () => Promise<void>
}

function makeHarness(options: HarnessOptions = {}) {
  let now = 0
  const tracks = [{ stop: vi.fn() }]
  const stream: CaptureStreamPort = { getTracks: () => tracks }
  const contexts: AudioContextPort[] = []
  const nodes: WorkletNodePort[] = []
  const batches: PcmBatch[] = []
  const levels: number[] = []
  const started: number[] = []
  const stopped: RecordingSummary[] = []
  const failed: string[] = []

  const ports: CaptureControllerPorts = {
    getUserMedia: options.userMedia ?? (async () => stream),
    createContext: () => {
      const context: AudioContextPort = {
        sampleRate: options.sampleRate ?? 16000,
        state: 'running',
        close: vi.fn(async () => {
          context.state = 'closed'
        })
      }
      contexts.push(context)
      return context
    },
    addWorkletModule: options.addModule ?? (async () => {}),
    createNode: () => {
      const node: WorkletNodePort = {
        port: { onmessage: null, close: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn()
      }
      nodes.push(node)
      return node
    },
    createSink: () => ({}),
    connect: () => {},
    now: () => now,
    onBatch: (batch) => batches.push(batch),
    onLevel: (level) => levels.push(level),
    sendStarted: (atMs) => started.push(atMs),
    sendStopped: (summary) => stopped.push(summary),
    sendFailed: (message) => failed.push(message)
  }

  return {
    ports,
    tracks,
    contexts,
    nodes,
    batches,
    levels,
    started,
    stopped,
    failed,
    advance: (ms: number) => {
      now += ms
    },
    emit: (samples: Float32Array): void => {
      const node = nodes.at(-1)
      node?.port.onmessage?.({ data: { samples, capturedAtMs: now, rms: 0.1 } })
    }
  }
}

describe('capture controller lifecycle', () => {
  it('starts, batches Float32 frames into Int16 20 ms batches, and stops once', async () => {
    const harness = makeHarness()
    const controller = new CaptureController(harness.ports)

    await controller.start()
    expect(controller.isRecording).toBe(true)
    expect(harness.started).toHaveLength(1)

    harness.emit(new Float32Array(320).fill(0.5))
    harness.advance(100)
    await controller.stop()

    expect(harness.batches).toHaveLength(1)
    expect(harness.batches[0]?.samples).toHaveLength(320)
    expect(harness.batches[0]?.samples[0]).toBe(16384)
    expect(harness.stopped).toEqual([
      { durationMs: 100, samples: 320, sampleRate: 16000, rms: 0.1 }
    ])
    expect(harness.tracks[0]?.stop).toHaveBeenCalledTimes(1)
    expect(harness.contexts[0]?.state).toBe('closed')

    await controller.stop()
    expect(harness.failed).toEqual([CAPTURE_NOTHING_TO_STOP_MESSAGE])
  })

  it('cancels cleanly when stop arrives during getUserMedia', async () => {
    let resolveStream: ((stream: CaptureStreamPort) => void) | undefined
    const harness = makeHarness({
      userMedia: () =>
        new Promise<CaptureStreamPort>((resolve) => {
          resolveStream = resolve
        })
    })
    const controller = new CaptureController(harness.ports)

    const starting = controller.start()
    await controller.stop()
    resolveStream?.({ getTracks: () => harness.tracks })
    await starting

    expect(harness.tracks[0]?.stop).toHaveBeenCalledTimes(1)
    expect(harness.started).toHaveLength(0)
    expect(harness.contexts).toHaveLength(0)
    expect(harness.failed).toEqual([CAPTURE_CANCELLED_MESSAGE])
  })

  it('rejects a retry while a start is still in progress', async () => {
    let resolveStream: ((stream: CaptureStreamPort) => void) | undefined
    const harness = makeHarness({
      userMedia: () =>
        new Promise<CaptureStreamPort>((resolve) => {
          resolveStream = resolve
        })
    })
    const controller = new CaptureController(harness.ports)

    const starting = controller.start()
    await expect(controller.start()).rejects.toThrow(CAPTURE_START_RETRY_MESSAGE)
    resolveStream?.({ getTracks: () => harness.tracks })
    await starting
    await controller.stop()
  })

  it('releases the microphone and context when the worklet module fails', async () => {
    let shouldFail = true
    const harness = makeHarness({
      addModule: async () => {
        if (shouldFail) throw new Error('module load failed')
      }
    })
    const controller = new CaptureController(harness.ports)

    await expect(controller.start()).rejects.toThrow(CAPTURE_MODULE_FAILED_MESSAGE)
    expect(harness.tracks[0]?.stop).toHaveBeenCalledTimes(1)
    expect(harness.contexts[0]?.state).toBe('closed')
    expect(harness.started).toHaveLength(0)

    shouldFail = false
    await controller.start()
    expect(harness.started).toHaveLength(1)
    await controller.stop()
  })

  it('refuses a context that is not 16 kHz', async () => {
    const harness = makeHarness({ sampleRate: 48000 })
    const controller = new CaptureController(harness.ports)

    await expect(controller.start()).rejects.toThrow(CAPTURE_SAMPLE_RATE_MESSAGE)
    expect(harness.tracks[0]?.stop).toHaveBeenCalledTimes(1)
    expect(harness.contexts[0]?.state).toBe('closed')
    expect(harness.started).toHaveLength(0)
  })

  it('flushes the final partial batch at stop', async () => {
    const harness = makeHarness()
    const controller = new CaptureController(harness.ports)
    await controller.start()
    harness.emit(new Float32Array(100).fill(0))
    await controller.stop()

    expect(harness.batches).toHaveLength(1)
    expect(harness.batches[0]?.samples).toHaveLength(100)
    expect(harness.stopped[0]?.samples).toBe(100)
  })

  it('disposes without sending a stop summary', async () => {
    const harness = makeHarness()
    const controller = new CaptureController(harness.ports)
    await controller.start()
    await controller.dispose()
    expect(harness.stopped).toHaveLength(0)
    expect(harness.tracks[0]?.stop).toHaveBeenCalledTimes(1)
  })
})
