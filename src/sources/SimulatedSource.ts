import type { IDataSource, SourceCapabilities } from './IDataSource';
import type { LightningStrike, SourceConfig } from '../types/lightning';

export const simulatedConfig: SourceConfig = {
  id: 'simulated',
  label: 'Simulated (Offline)',
  description: 'Randomly generated strikes. No internet required — great for testing.',
  fields: [
    {
      key: 'lat',
      label: 'Center Latitude',
      type: 'number',
      default: 48.0,
      placeholder: 'e.g. 48.0',
    },
    {
      key: 'lon',
      label: 'Center Longitude',
      type: 'number',
      default: 11.0,
      placeholder: 'e.g. 11.0',
    },
    {
      key: 'rate',
      label: 'Strikes per minute',
      type: 'number',
      default: 12,
      placeholder: 'e.g. 12',
    },
    {
      key: 'radius',
      label: 'Radius (degrees)',
      type: 'number',
      default: 5,
      placeholder: 'e.g. 5',
    },
  ],
};

export class SimulatedSource implements IDataSource {
  readonly config = simulatedConfig;
  readonly capabilities: SourceCapabilities = {
    hasPolarity:  true,
    hasAmplitude: true,
    hasAltitude:  true,
    hasDelay:     true,
    isRealtime:   true,
  };
  private listeners: Array<(s: LightningStrike) => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;

  get connected() {
    return this._connected;
  }

  async connect(settings: Record<string, string | number>): Promise<void> {
    const lat = Number(settings.lat ?? 48.0);
    const lon = Number(settings.lon ?? 11.0);
    const rate = Math.max(1, Number(settings.rate ?? 12));
    const radius = Number(settings.radius ?? 5);
    this._connected = true;
    this.schedule(lat, lon, rate, radius);
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this._connected = false;
  }

  onStrike(cb: (s: LightningStrike) => void) {
    this.listeners.push(cb);
  }

  offStrike(cb: (s: LightningStrike) => void) {
    this.listeners = this.listeners.filter((l) => l !== cb);
  }

  private schedule(lat: number, lon: number, rate: number, radius: number) {
    if (!this._connected) return;
    // Poisson-distributed inter-arrival times for natural feel
    const meanMs = (60 / rate) * 1000;
    const delay = -Math.log(Math.random()) * meanMs;

    this.timer = setTimeout(() => {
      const strike = this.generate(lat, lon, radius);
      this.listeners.forEach((cb) => cb(strike));
      this.schedule(lat, lon, rate, radius);
    }, delay);
  }

  private generate(centerLat: number, centerLon: number, radius: number): LightningStrike {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * radius; // uniform in circle
    return {
      id: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time: Date.now(),
      lat: centerLat + dist * Math.cos(angle),
      lon: centerLon + dist * Math.sin(angle),
      polarity: Math.random() < 0.7 ? -1 : 1, // ~70% negative (realistic ratio)
      amplitude: 10 + Math.random() * 190,     // 10–200 kA
      altitude: Math.random() < 0.8 ? 0 : Math.random() * 8000,
      delay: Math.random() * 3,
      source: 'simulated',
    };
  }
}
