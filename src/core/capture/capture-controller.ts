import type { PcmBatch, RecordingSummary } from '../../shared/ipc'
import { PcmBatcher } from './pcm-batcher'

export interface CaptureTrackPort {
  stop(): void
}

export interface CaptureStreamPort {
  getTracks(): CaptureTrackPort[]
}

export interface AudioContextPort {
  sampleRate: number
  state: string
  close(): Promise<void>
}

export interface WorkletMessage {
  samples?: Float32Array
  rms?: number
  capturedAtMs?: number
}

export interface WorkletPort {
  onmessage: ((event: { data: WorkletMessage }) => void) | null
  close(): void
}

export interface WorkletNodePort {
  port: WorkletPort
  connect(target: unknown): void
  disconnect(): void
}

export interface CaptureControllerPorts {
  getUserMedia(): Promise<CaptureStreamPort>
  createContext(sampleRate: number): AudioContextPort
  addWorkletModule(context: AudioContextPort): Promise<void>
  createNode(context: AudioContextPort): WorkletNodePort
  createSink(context: AudioContextPort): unknown
  connect(
    stream: CaptureStreamPort,
    node: WorkletNodePort,
    sink: unknown,
    context: AudioContextPort
  ): void
  now(): number
  onBatch(batch: PcmBatch): void
  onLevel(rms: number): void
  sendStarted(atMs: number): void
  sendStopped(summary: RecordingSummary): void
  sendFailed(message: string): void
}

export const CAPTURE_START_RETRY_MESSAGE = '录音正在启动，请稍候再试。'
export const CAPTURE_CANCELLED_MESSAGE = '录音启动被取消，请重试。'
export const CAPTURE_NOTHING_TO_STOP_MESSAGE = '没有可停止的录音，请重试。'
export const CAPTURE_MODULE_FAILED_MESSAGE = '录音模块加载失败，请重试。'
export const CAPTURE_SAMPLE_RATE_MESSAGE = '录音采样率不受支持（需要 16 kHz），请重试。'

/**
 * Renderer-facing capture lifecycle as a pure state machine over ports.
 * No DOM, Electron, or AudioWorklet globals are referenced here so the M0
 * lifecycle edges are unit-testable (ADR-0001/0003).
 */
export class CaptureController {
  private readonly ports: CaptureControllerPorts
  private stream: CaptureStreamPort | null = null
  private context: AudioContextPort | null = null
  private node: WorkletNodePort | null = null
  private sink: unknown = null
  private starting = false
  private cancelled = false
  private session = 0
  private startedAtMs = 0
  private samples = 0
  private rmsBlocks = 0
  private rmsSum = 0
  private lastLevelAtMs = 0
  private batcher = new PcmBatcher()

  constructor(ports: CaptureControllerPorts) {
    this.ports = ports
  }

  get isRecording(): boolean {
    return this.context !== null && !this.starting
  }

  async start(): Promise<void> {
    if (this.starting) throw new Error(CAPTURE_START_RETRY_MESSAGE)
    if (this.context) return

    const session = this.session + 1
    this.session = session
    this.cancelled = false
    this.starting = true

    let stream: CaptureStreamPort | null = null
    let context: AudioContextPort | null = null
    let node: WorkletNodePort | null = null

    try {
      stream = await this.ports.getUserMedia()
      if (this.cancelled || session !== this.session) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      context = this.ports.createContext(16000)
      if (context.sampleRate !== 16000) {
        throw new Error(CAPTURE_SAMPLE_RATE_MESSAGE)
      }
      try {
        await this.ports.addWorkletModule(context)
      } catch (cause) {
        throw new Error(CAPTURE_MODULE_FAILED_MESSAGE, { cause })
      }
      if (this.cancelled || session !== this.session) {
        stream.getTracks().forEach((track) => track.stop())
        await context.close().catch(() => {})
        return
      }

      node = this.ports.createNode(context)
      const sink = this.ports.createSink(context)
      node.port.onmessage = (event) => this.handleMessage(event.data)
      this.ports.connect(stream, node, sink, context)

      this.stream = stream
      this.context = context
      this.node = node
      this.sink = sink
      this.startedAtMs = this.ports.now()
      this.samples = 0
      this.rmsBlocks = 0
      this.rmsSum = 0
      this.lastLevelAtMs = 0
      this.batcher = new PcmBatcher()

      this.ports.sendStarted(this.startedAtMs)
    } catch (cause) {
      node?.disconnect()
      stream?.getTracks().forEach((track) => track.stop())
      if (context && context.state !== 'closed') {
        await context.close().catch(() => {})
      }
      throw cause
    } finally {
      this.starting = false
    }
  }

  async stop(): Promise<void> {
    if (this.starting) {
      this.cancelled = true
      this.session += 1
      this.ports.sendFailed(CAPTURE_CANCELLED_MESSAGE)
      return
    }

    const context = this.context
    if (!context) {
      this.ports.sendFailed(CAPTURE_NOTHING_TO_STOP_MESSAGE)
      return
    }

    const finalBatch = this.batcher.flush()
    if (finalBatch) {
      this.samples += finalBatch.samples.length
      this.ports.onBatch(finalBatch)
    }

    const summary: RecordingSummary = {
      durationMs: Math.round(this.ports.now() - this.startedAtMs),
      samples: this.samples,
      sampleRate: context.sampleRate,
      rms: this.rmsBlocks > 0 ? this.rmsSum / this.rmsBlocks : 0
    }

    await this.release()
    this.ports.sendStopped(summary)
  }

  async dispose(): Promise<void> {
    this.cancelled = true
    this.session += 1
    await this.release()
  }

  private handleMessage(message: WorkletMessage): void {
    if (this.cancelled || !this.context) return
    const rms = typeof message.rms === 'number' ? message.rms : 0
    this.rmsBlocks += 1
    this.rmsSum += rms

    const now = this.ports.now()
    if (now - this.lastLevelAtMs > 50) {
      this.lastLevelAtMs = now
      this.ports.onLevel(rms)
    }

    const samples = message.samples
    if (!samples || samples.length === 0) return
    const capturedAtMs =
      typeof message.capturedAtMs === 'number' ? message.capturedAtMs : Math.round(now)
    const batches = this.batcher.push(samples, capturedAtMs)
    for (const batch of batches) {
      this.samples += batch.samples.length
      this.ports.onBatch(batch)
    }
  }

  private async release(): Promise<void> {
    const context = this.context
    this.node?.port.close()
    this.node?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())

    this.context = null
    this.stream = null
    this.node = null
    this.sink = null
    this.ports.onLevel(0)

    if (context && context.state !== 'closed') {
      await context.close().catch(() => {})
    }
  }
}
