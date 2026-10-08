import { ReplayLimitExceededError } from './replay-limit-exceeded-error.js';

/** Checks elapsed time even when a suspended tab has not run its expiry timer. */
export class ReplayDeadline {
  private readonly startedAt = Date.now();
  private readonly startedTick = performance.now();
  private expiresAt = Infinity;
  private maximumMs = 1800_000;

  configure(expiresAt: string, maxReplaySeconds: number): void {
    const deadline = Date.parse(expiresAt);
    if (!Number.isFinite(deadline) || !Number.isInteger(maxReplaySeconds) || maxReplaySeconds < 1 || maxReplaySeconds > 1800)
      throw new Error('Invalid recording time limit.');
    this.expiresAt = deadline;
    this.maximumMs = maxReplaySeconds * 1000;
    this.assertWithinLimit();
  }

  get remainingMilliseconds(): number {
    return Math.min(this.expiresAt - Date.now(), this.maximumMs - (Date.now() - this.startedAt),
      this.maximumMs - (performance.now() - this.startedTick));
  }

  assertWithinLimit(): void {
    if (this.remainingMilliseconds <= 0) throw new ReplayLimitExceededError();
  }
}
