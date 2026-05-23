import type { IDataSource, SourceCapabilities } from './IDataSource';
import type { LightningStrike, SourceConfig } from '../types/lightning';

// Injected at build time by Vite from .env
const ENV_KEY = import.meta.env.VITE_OPENWEATHER_KEY as string ?? '';

interface OWStrike {
  id: string;
  datetime: string;   // ISO-8601 UTC
  lat: number;
  lon: number;
  quality: 'good' | 'medium' | 'bad' | 'undefined';
  error: number;      // location uncertainty in km
}

interface OWResponse {
  data: OWStrike[];
}

// Quality → amplitude proxy (kA): used when real amplitude is unavailable
const QUALITY_AMPLITUDE: Record<string, number> = {
  good:      120,
  medium:     70,
  bad:        30,
  undefined:  50,
};

// How much of the poll interval to use for playback (leaves headroom before next fetch)
const PLAYBACK_FILL = 0.88;
// Minimum spacing between clustered strikes (ms) — prevents them all sounding at once
const MIN_CLUSTER_SPACING_MS = 400;
// If total span of received strikes is shorter than this, treat as a cluster (ms)
const CLUSTER_THRESHOLD_MS = 5_000;

export const openWeatherConfig: SourceConfig = {
  id: 'openweather',
  label: 'OpenWeather (Live)',
  description:
    'Polls OpenWeather Lightning API on a timer and distributes received strikes ' +
    'across the interval using their real timestamps — longer intervals work fine. ' +
    'At 240s: ~360 API calls/day (free tier limit: 1 000/day).',
  fields: [
    {
      key: 'lat',
      label: 'Centre Latitude',
      type: 'number',
      default: 48.0,
      placeholder: 'e.g. 48.0',
    },
    {
      key: 'lon',
      label: 'Centre Longitude',
      type: 'number',
      default: 11.0,
      placeholder: 'e.g. 11.0',
    },
    {
      key: 'radius',
      label: 'Scan radius',
      type: 'select',
      default: 300,
      options: [
        { value: '100', label: '100 km' },
        { value: '300', label: '300 km' },
        { value: '500', label: '500 km' },
      ],
    },
    {
      key: 'interval',
      label: 'Poll interval (seconds)',
      type: 'number',
      default: 240,
      placeholder: 'e.g. 240',
    },
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'text',
      default: ENV_KEY,
      placeholder: 'Your OpenWeather API key',
    },
  ],
};

export class OpenWeatherSource implements IDataSource {
  readonly config = openWeatherConfig;
  readonly capabilities: SourceCapabilities = {
    hasPolarity:  false,  // not provided by OpenWeather
    hasAmplitude: false,  // quality used as amplitude proxy
    hasAltitude:  false,
    hasDelay:     false,
    isRealtime:   false,  // polling, not push
  };

  /** Called each time a poll fires, with the interval in ms. Wire up for UI countdowns. */
  onPollTick?: (intervalMs: number) => void;

  private listeners: Array<(s: LightningStrike) => void> = [];
  private _connected = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pendingTimers: ReturnType<typeof setTimeout>[] = [];
  private lastFetchTime: Date | null = null;
  private seenIds = new Set<string>();
  private intervalMs = 240_000;

  get connected() { return this._connected; }

  async connect(settings: Record<string, string | number>): Promise<void> {
    const lat      = Number(settings.lat      ?? 48.0);
    const lon      = Number(settings.lon      ?? 11.0);
    const radius   = Math.max(1, Number(settings.radius ?? 300));
    const interval = Math.max(60, Number(settings.interval ?? 240)) * 1000;
    const apiKey   = String(settings.apiKey   ?? ENV_KEY);

    if (!apiKey) throw new Error('API key is required for OpenWeather source.');

    this.intervalMs = interval;

    // Fetch immediately, schedule remainder
    await this.fetchAndSchedule(lat, lon, radius, apiKey);
    this._connected = true;

    this.pollTimer = setInterval(async () => {
      if (this._connected) await this.fetchAndSchedule(lat, lon, radius, apiKey);
    }, interval);
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    for (const t of this.pendingTimers) clearTimeout(t);
    this.pendingTimers = [];
    this._connected = false;
    this.lastFetchTime = null;
    this.seenIds.clear();
    this.onPollTick = undefined;
  }

  onStrike(cb: (s: LightningStrike) => void)  { this.listeners.push(cb); }
  offStrike(cb: (s: LightningStrike) => void) {
    this.listeners = this.listeners.filter((l) => l !== cb);
  }

  // ---------------------------------------------------------------- fetch --

  private async fetchAndSchedule(
    lat: number, lon: number, radius: number, apiKey: string
  ): Promise<void> {
    this.onPollTick?.(this.intervalMs);
    const now      = new Date();
    // First fetch: look back one full interval; subsequent: overlap by 5s to avoid gaps
    const lookback = this.lastFetchTime
      ? new Date(this.lastFetchTime.getTime() - 5_000)
      : new Date(now.getTime() - this.intervalMs);

    const url =
      `https://api.openweathermap.org/v3/lightning?` +
      `lat=${lat}&lon=${lon}&radius=${radius}` +
      `&start_date=${encodeURIComponent(lookback.toISOString())}` +
      `&end_date=${encodeURIComponent(now.toISOString())}` +
      `&appid=${apiKey}`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (e) {
      console.warn('[OpenWeather] Network error:', e);
      return;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`[OpenWeather] HTTP ${response.status}: ${body}`);
      return;
    }

    let data: OWResponse;
    try {
      data = await response.json();
    } catch {
      console.warn('[OpenWeather] Failed to parse JSON response');
      return;
    }

    this.lastFetchTime = now;

    // Deduplicate against previously seen IDs
    const fresh = (data.data ?? [])
      .filter((s) => !this.seenIds.has(s.id))
      .map((s) => this.normalise(s));

    for (const s of fresh) this.seenIds.add(s.id);

    // Trim seenIds if it grows too large
    if (this.seenIds.size > 2000) {
      const arr = [...this.seenIds];
      this.seenIds = new Set(arr.slice(-1000));
    }

    if (fresh.length > 0) {
      this.distributeStrikes(fresh);
    }
  }

  // ----------------------------------------------- temporal distribution --

  /**
   * Schedules playback of a batch of strikes spread across the poll interval,
   * preserving their relative temporal spacing from the real timestamps.
   *
   * - Single strike: small random offset (natural feel)
   * - Burst (all within CLUSTER_THRESHOLD_MS): evenly spaced at MIN_CLUSTER_SPACING_MS
   * - Normal case: scale the real time span to fill PLAYBACK_FILL of the interval
   */
  private distributeStrikes(strikes: LightningStrike[]): void {
    // Sort oldest-first so they play in the correct order
    const sorted = [...strikes].sort((a, b) => a.time - b.time);
    const playbackWindowMs = this.intervalMs * PLAYBACK_FILL;

    if (sorted.length === 1) {
      // Single strike — add a small natural offset so it doesn't always fire at t=0
      const delay = Math.random() * Math.min(3_000, playbackWindowMs * 0.1);
      this.scheduleStrike(sorted[0], delay);
      return;
    }

    const firstTime = sorted[0].time;
    const lastTime  = sorted[sorted.length - 1].time;
    const span      = lastTime - firstTime;

    if (span < CLUSTER_THRESHOLD_MS) {
      // All strikes arrived in a tight burst — space them evenly
      sorted.forEach((strike, i) => {
        const delay = i * MIN_CLUSTER_SPACING_MS;
        this.scheduleStrike(strike, delay);
      });
      return;
    }

    // Scale real timestamp span to playback window, preserving relative rhythm
    sorted.forEach((strike) => {
      const relativePosition = (strike.time - firstTime) / span;
      const delay = relativePosition * playbackWindowMs;
      this.scheduleStrike(strike, delay);
    });
  }

  private scheduleStrike(strike: LightningStrike, delayMs: number): void {
    const t = setTimeout(() => {
      if (!this._connected) return;
      this.listeners.forEach((cb) => cb(strike));
      // Remove from pending list once fired
      this.pendingTimers = this.pendingTimers.filter((x) => x !== t);
    }, delayMs);
    this.pendingTimers.push(t);
  }

  // ------------------------------------------------------------- normalise --

  private normalise(raw: OWStrike): LightningStrike {
    return {
      id:        `ow-${raw.id}`,
      time:      new Date(raw.datetime).getTime(),
      lat:       raw.lat,
      lon:       raw.lon,
      polarity:  0,
      amplitude: QUALITY_AMPLITUDE[raw.quality] ?? 50,
      altitude:  0,
      delay:     0,
      source:    'openweather',
    };
  }
}
