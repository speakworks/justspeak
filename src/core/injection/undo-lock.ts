/**
 * The deletion mutex.
 *
 * A guard decision and the keystrokes are asynchronous; two entry points can
 * both pass the guard during the probe delay. Exactly one may delete. The
 * acquisition happens synchronously, after the guard and immediately before the
 * slot is consumed, so the second caller is refused rather than deleting the
 * same text twice.
 */
export class UndoLock {
  private held = false

  get locked(): boolean {
    return this.held
  }

  tryAcquire(): boolean {
    if (this.held) return false
    this.held = true
    return true
  }

  release(): void {
    this.held = false
  }
}
