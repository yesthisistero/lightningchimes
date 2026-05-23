import type { LightningStrike, SourceConfig } from '../types/lightning';

/** Declares which fields a source actually populates on LightningStrike. */
export interface SourceCapabilities {
  hasPolarity: boolean;   // strike.polarity is meaningful (not always 0)
  hasAmplitude: boolean;  // strike.amplitude is meaningful (not always 0)
  hasAltitude: boolean;   // strike.altitude is meaningful (not always 0)
  hasDelay: boolean;      // strike.delay is meaningful (not always 0)
  isRealtime: boolean;    // pushes data as it happens (vs. polling)
}

export interface IDataSource {
  readonly config: SourceConfig;
  readonly capabilities: SourceCapabilities;
  readonly connected: boolean;
  connect(settings: Record<string, string | number>): Promise<void>;
  disconnect(): Promise<void>;
  onStrike(cb: (strike: LightningStrike) => void): void;
  offStrike(cb: (strike: LightningStrike) => void): void;
}
