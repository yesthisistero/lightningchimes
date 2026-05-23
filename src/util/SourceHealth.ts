/**
 * Tracks strike rate and last-seen timestamp for a connected data source.
 * Maintains a rolling 5-minute window of strike timestamps.
 */
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export class SourceHealth {
  private timestamps: number[] = [];
  private lastStrikeTime: number | null = null;
  private onUpdate: (() => void) | null = null;

  setUpdateCallback(cb: () => void) {
    this.onUpdate = cb;
  }

  recordStrike() {
    const now = Date.now();
    this.lastStrikeTime = now;
    this.timestamps.push(now);
    this.prune();
    this.onUpdate?.();
  }

  /** Strikes per minute over the last 5 minutes. */
  getRate(): number {
    this.prune();
    if (this.timestamps.length < 2) return this.timestamps.length;
    const windowSec = WINDOW_MS / 1000;
    return (this.timestamps.length / windowSec) * 60;
  }

  getLastStrikeTime(): number | null {
    return this.lastStrikeTime;
  }

  /** Human-readable time since last strike, e.g. "3s ago", "2m ago". */
  getLastStrikeLabel(): string {
    if (!this.lastStrikeTime) return 'no strikes yet';
    const diffMs = Date.now() - this.lastStrikeTime;
    if (diffMs < 60_000) return `${Math.round(diffMs / 1000)}s ago`;
    return `${Math.round(diffMs / 60_000)}m ago`;
  }

  reset() {
    this.timestamps = [];
    this.lastStrikeTime = null;
    this.onUpdate?.();
  }

  private prune() {
    const cutoff = Date.now() - WINDOW_MS;
    this.timestamps = this.timestamps.filter((t) => t > cutoff);
  }
}
