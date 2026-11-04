import { existsSync, statSync } from 'node:fs'
import {
  buildDecisionPrompt,
  parseCorrectionDecision,
  type CorrectionAction
} from '../../core/llm/decision'
import { correctWithLlm, type LlmCorrectionResult } from '../../core/llm/correction'
import type { LlmBackend, LlmLocalState } from '../../shared/ipc'
import { LlamaSidecar } from './sidecar'

export interface LlmCorrectorConfig {
  backend: LlmBackend
  baseUrl: string
  model: string
}

export interface LlmCorrectorDeps {
  runtimePath: string
  localModelPath: string
  /** Expected GGUF size; omitted by the evaluation harness, which uses any GGUF. */
  localModelSize?: number
  keyStore: { load: () => Promise<string | undefined> }
  fetch?: typeof fetch
  /** Called whenever the local sidecar lifecycle changes, for UI pushes. */
  onLocalStatusChange?: (status: LlmLocalStatus) => void
}

/** What the local backend is doing right now, for an honest settings row. */
export interface LlmLocalStatus {
  state: LlmLocalState
  error?: string
}

/** Calls one OpenAI-compatible endpoint with a hard timeout. */
async function endpointDecision(
  config: LlmCorrectorConfig,
  key: string | undefined,
  text: string,
  fetchImpl: typeof fetch
): Promise<CorrectionAction | null> {
  // The caller may have switched away while the key was being decrypted; never
  // send a transcript to an endpoint that is no longer selected.
  if (config.backend !== 'endpoint') return null
  const base = config.baseUrl.replace(/\/+$/, '')
  if (base.length === 0 || config.model.trim().length === 0) return null
  const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
  const prompt = buildDecisionPrompt(text)
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {})
      },
      signal: AbortSignal.timeout(800),
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: 32,
        stream: false,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ]
      })
    })
    if (!response.ok) {
      console.warn(`[llm] endpoint returned HTTP ${response.status}`)
      return null
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = payload.choices?.[0]?.message?.content
    return typeof content === 'string' ? parseCorrectionDecision(content) : null
  } catch (error) {
    console.warn('[llm] endpoint decision failed', error)
    return null
  }
}

/**
 * The optional correction stage. It never throws into dictation: missing
 * runtime/model, a slow endpoint, or an invalid action all return the
 * rule-cleaned text unchanged.
 */
export class LlmCorrector {
  private readonly deps: LlmCorrectorDeps
  private config: LlmCorrectorConfig = { backend: 'off', baseUrl: '', model: '' }
  private sidecar?: LlamaSidecar
  /** A sidecar whose `start()` has not resolved yet; quit must stop it too. */
  private startingSidecar?: LlamaSidecar
  private warmupPromise?: Promise<void>
  private sidecarStopping?: Promise<void>
  /** Instances whose graceful stop is still in flight; quit must reach them. */
  private readonly stoppingSidecars = new Set<LlamaSidecar>()
  private disposed = false
  private localState: LlmLocalState = 'idle'
  private localError?: string
  /** Bumped on every stop so an in-flight start cannot install a stale child. */
  private localGeneration = 0

  constructor(deps: LlmCorrectorDeps) {
    this.deps = deps
  }

  get localStatus(): LlmLocalStatus {
    return {
      state: this.localState,
      ...(this.localError === undefined ? {} : { error: this.localError })
    }
  }

  private setLocalState(state: LlmLocalState, error?: string): void {
    if (this.localState === state && this.localError === error) return
    this.localState = state
    this.localError = error
    try {
      this.deps.onLocalStatusChange?.(this.localStatus)
    } catch (callbackError) {
      console.warn('[llm] local status listener failed', callbackError)
    }
  }

  configure(config: LlmCorrectorConfig): void {
    const wasLocal = this.config.backend === 'local'
    this.config = config
    if (wasLocal && config.backend !== 'local') {
      this.setLocalState('idle')
      void this.stopSidecar()
    }
    if (config.backend === 'local') {
      if (!wasLocal) this.setLocalState('idle')
      void this.warmup()
    }
  }

  /**
   * Start the local model in the background; the first dictation should not
   * pay 9 s. Resolves true only when a live sidecar is actually ready, so the
   * evaluation harness can refuse to score a model that never started.
   */
  warmup(): Promise<boolean> {
    if (this.disposed || this.config.backend !== 'local') return Promise.resolve(false)
    if (this.sidecar) {
      if (this.sidecar.alive) return Promise.resolve(true)
      this.dropDeadSidecar()
    }
    if (!existsSync(this.deps.runtimePath)) {
      this.setLocalState('failed', `本地运行时缺失：${this.deps.runtimePath}`)
      return Promise.resolve(false)
    }
    if (!this.modelReady()) {
      this.setLocalState('failed', '本地模型尚未下载或文件不完整。')
      return Promise.resolve(false)
    }
    if (!this.warmupPromise) {
      this.setLocalState('starting')
      const starting = this.startLocal()
      this.warmupPromise = starting
      void starting
        .finally(() => {
          if (this.warmupPromise === starting) this.warmupPromise = undefined
        })
        .catch(() => undefined)
    }
    return this.warmupPromise.then(() => this.sidecar !== undefined && this.sidecar.alive)
  }

  /**
   * The download verifies SHA-256 before the atomic rename; at use time a size
   * check catches truncation without hashing 1.1 GB on every dictation.
   */
  private modelReady(): boolean {
    try {
      if (!existsSync(this.deps.localModelPath)) return false
      if (this.deps.localModelSize === undefined) return true
      return statSync(this.deps.localModelPath).size === this.deps.localModelSize
    } catch {
      return false
    }
  }

  private async startLocal(): Promise<void> {
    // Claim the token before awaiting a pending stop. If several starts queue
    // behind the same stop, only the newest may spawn; claiming after the
    // await would let every waiter observe the same generation and install
    // competing children (all but the last untracked).
    const generation = ++this.localGeneration
    if (this.sidecarStopping) await this.sidecarStopping
    if (
      this.disposed ||
      this.config.backend !== 'local' ||
      generation !== this.localGeneration
    ) {
      return
    }
    const sidecar: LlamaSidecar = new LlamaSidecar({
      binaryPath: this.deps.runtimePath,
      modelPath: this.deps.localModelPath,
      onExit: () => this.dropDeadSidecar(sidecar)
    })
    // Track the instance before awaiting start(): dispose()/quit must be able
    // to signal a child that is still loading the model.
    this.startingSidecar = sidecar
    try {
      await sidecar.start()
      // A stop may have happened while the model loaded; never install that
      // child as the live sidecar even if the backend is local again.
      if (
        this.disposed ||
        this.config.backend !== 'local' ||
        generation !== this.localGeneration
      ) {
        await sidecar.stop(true)
        return
      }
      this.sidecar = sidecar
      this.setLocalState('ready')
    } catch (error) {
      if (
        !this.disposed &&
        this.config.backend === 'local' &&
        generation === this.localGeneration
      ) {
        this.setLocalState(
          'failed',
          error instanceof Error ? error.message : String(error)
        )
      }
      console.warn('[llm] local sidecar unavailable', error)
      await sidecar.stop()
    } finally {
      if (this.startingSidecar === sidecar) this.startingSidecar = undefined
    }
  }

  /** Forget a dead sidecar so the next utterance warms a fresh one. */
  private dropDeadSidecar(dead?: LlamaSidecar): void {
    if (this.sidecar === undefined) return
    if (dead !== undefined && this.sidecar !== dead) return
    this.sidecar = undefined
    if (!this.disposed) {
      this.setLocalState('failed', '本地模型进程已退出，将在下次听写时重新启动。')
    }
  }

  async refine(text: string): Promise<LlmCorrectionResult | undefined> {
    if (this.config.backend === 'off') return undefined
    return correctWithLlm(text, (value) => this.decide(value))
  }

  private async decide(text: string): Promise<CorrectionAction | null> {
    if (this.config.backend === 'local') {
      const sidecar = this.sidecar
      if (sidecar && !sidecar.alive) this.dropDeadSidecar(sidecar)
      // Never put a cold 9 s model load on the dictation path: start warming in
      // the background and let this utterance use the rule text.
      if (!sidecar || !sidecar.alive) {
        void this.warmup()
        return null
      }
      const result = await sidecar.decide(text, 800)
      // The sidecar may have crashed, or been replaced, during the request;
      // only drop this exact instance.
      if (!sidecar.alive) this.dropDeadSidecar(sidecar)
      return result.action
    }

    const snapshot = { ...this.config }
    if (snapshot.backend !== 'endpoint') return null
    const key = await this.deps.keyStore.load()
    // Re-check after the await: the user may have switched backends while the
    // key was being decrypted.
    if (this.config.backend !== 'endpoint') return null
    return endpointDecision(snapshot, key, text, this.deps.fetch ?? fetch)
  }

  private stopSidecar(force = false): Promise<void> {
    this.localGeneration += 1
    // A cancelled start must not be shared by a later warmup for the same
    // backend; the next call starts a fresh child.
    this.warmupPromise = undefined
    const targets = new Set<LlamaSidecar>()
    if (this.sidecar) targets.add(this.sidecar)
    if (this.startingSidecar) targets.add(this.startingSidecar)
    // Previously stopped instances may still be inside their graceful window;
    // keep them reachable so a later force stop can escalate to SIGKILL.
    for (const target of this.stoppingSidecars) targets.add(target)
    this.sidecar = undefined
    this.startingSidecar = undefined
    if (targets.size === 0) return this.sidecarStopping ?? Promise.resolve()

    for (const target of targets) this.stoppingSidecars.add(target)
    const stopped = Promise.all([...targets].map((target) => target.stop(force)))
      .then(() => undefined)
      .finally(() => {
        for (const target of targets) this.stoppingSidecars.delete(target)
      })
    const tracked = stopped.finally(() => {
      if (this.sidecarStopping === tracked) this.sidecarStopping = undefined
    })
    this.sidecarStopping = tracked
    return tracked
  }

  async dispose(force = false): Promise<void> {
    this.disposed = true
    this.setLocalState('idle')
    const warmup = this.warmupPromise
    await this.stopSidecar(force)
    if (warmup) {
      // Let the in-flight start observe the stop instead of spawning after the
      // app has already exited. Bounded so quit cannot hang on a stuck child.
      await Promise.race([
        warmup.then(
          () => undefined,
          () => undefined
        ),
        new Promise<void>((resolve) => setTimeout(resolve, 1500))
      ])
    }
  }
}
