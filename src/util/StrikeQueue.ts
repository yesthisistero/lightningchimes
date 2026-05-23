import type { LightningStrike } from '../types/lightning';

export interface QueueConfig {
  maxStrikesPerSecond: number;
  maxPolyphony?: number;
}

/**
 * Throttles incoming lightning strikes to prevent audio thread overload.
 * Implements dual rate-limiting:
 * 1. Time-based: max N strikes per second
 * 2. Polyphony-based: max M simultaneous voices (optional)
 */
const DEDUP_WINDOW_MS = 500;

export class StrikeQueue {
  private queue: LightningStrike[] = [];
  private lastEmitTime = 0;
  private activeVoices = 0;
  private maxStrikesPerSecond: number;
  private maxPolyphony: number;
  private processing = false;
  private onStrike: (strike: LightningStrike) => Promise<void> = async () => {};
  // Deduplication: id → timestamp of first seen
  private seenIds = new Map<string, number>();

  constructor(config: QueueConfig) {
    this.maxStrikesPerSecond = config.maxStrikesPerSecond;
    this.maxPolyphony = config.maxPolyphony ?? 12;
  }

  setCallback(cb: (strike: LightningStrike) => Promise<void>): void {
    this.onStrike = cb;
  }

  push(strike: LightningStrike): void {
    const now = Date.now();

    // Expire old dedup entries to prevent unbounded memory growth
    for (const [id, ts] of this.seenIds) {
      if (now - ts > DEDUP_WINDOW_MS) this.seenIds.delete(id);
    }

    // Drop duplicate strikes from the same sensor confirmation burst
    if (this.seenIds.has(strike.id)) return;
    this.seenIds.set(strike.id, now);

    this.queue.push(strike);
    this.process();
  }

  noteVoiceStart(): void {
    this.activeVoices++;
  }

  noteVoiceEnd(): void {
    this.activeVoices = Math.max(0, this.activeVoices - 1);
    this.process();
  }

  private async process(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    while (this.queue.length > 0) {
      // Check time-based throttle: minimum interval between strikes
      const now = Date.now();
      const minInterval = 1000 / this.maxStrikesPerSecond;
      const timeSinceLastEmit = now - this.lastEmitTime;

      if (timeSinceLastEmit < minInterval) {
        // Wait before processing next strike
        await new Promise((resolve) => setTimeout(resolve, minInterval - timeSinceLastEmit));
      }

      // Check polyphony: wait if too many voices active
      if (this.activeVoices >= this.maxPolyphony) {
        // Wait a bit for some voices to finish
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (this.activeVoices >= this.maxPolyphony) {
          // Still too many — drop this strike
          this.queue.shift();
          continue;
        }
      }

      const strike = this.queue.shift();
      if (!strike) break;

      this.lastEmitTime = Date.now();
      await this.onStrike(strike);
      // Note: the audio engine should call noteVoiceEnd() when the voice stops
    }
    this.processing = false;
  }

  getStats() {
    return {
      queuedStrikes: this.queue.length,
      activeVoices: this.activeVoices,
      maxPolyphony: this.maxPolyphony,
    };
  }
}
