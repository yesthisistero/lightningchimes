import type { IDataSource, SourceCapabilities } from './IDataSource';
import type { LightningStrike, SourceConfig } from '../types/lightning';

// Blitzortung public WebSocket servers — rotated on failure
const WS_SERVERS = [
  'wss://ws1.blitzortung.org',
  'wss://ws2.blitzortung.org',
  'wss://ws7.blitzortung.org',
  'wss://ws8.blitzortung.org',
];

// -------------------------------------------------- Blitzortung wire format --

interface BzStrike {
  time:    number;   // nanoseconds since epoch
  lat:     number;
  lon:     number;
  alt?:    number;
  del?:    number;   // delay in µs (alternate field name)
  delay?:  number;
  latc?:   number;   // latitude correction
  lonc?:   number;   // longitude correction
  sig?:    number;
  mds?:    number;
  mcg?:    number;
  status?: number;
  region?: number;
}

// ------------------------------------------------------- LZW decompression --
// Transcribed from Blitzortung's lbr.js. Messages arrive as LZW-compressed
// strings; we decode before JSON.parse().

function lzwDecode(s: string): string {
  const dict: Record<number, string> = {};
  let prev  = s[0];
  const out = [prev];
  let code  = 256;
  for (let i = 1; i < s.length; i++) {
    const cc     = s.charCodeAt(i);
    const phrase = cc < 256 ? s[i] : (dict[cc] ?? prev + prev[0]);
    out.push(phrase);
    dict[code++] = prev + phrase[0];
    prev = phrase;
  }
  return out.join('');
}

// -------------------------------------------------------- Haversine filter --

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ------------------------------------------------------------------ config --

export const blitzortungConfig: SourceConfig = {
  id: 'blitzortung',
  label: 'Blitzortung (Live)',
  description:
    'Real-time lightning data from the Blitzortung community network via WebSocket. ' +
    'Global coverage, ~1–5 s latency. No API key required.',
  fields: [
    {
      key:         'lat',
      label:       'Centre Latitude',
      type:        'number',
      default:     48.0,
      placeholder: 'e.g. 48.0',
    },
    {
      key:         'lon',
      label:       'Centre Longitude',
      type:        'number',
      default:     11.0,
      placeholder: 'e.g. 11.0',
    },
    {
      key:     'radius',
      label:   'Scan radius',
      type:    'select',
      default: 1000,
      options: [
        { value: '500',  label: '500 km'   },
        { value: '1000', label: '1 000 km' },
        { value: '2000', label: '2 000 km' },
        { value: '0',    label: 'Global'   },
      ],
    },
  ],
};

// ------------------------------------------------------------------ source --

export class BlitzortungSource implements IDataSource {
  readonly config = blitzortungConfig;
  readonly capabilities: SourceCapabilities = {
    hasPolarity:  false,  // not exposed by Blitzortung's public API
    hasAmplitude: false,
    hasAltitude:  true,
    hasDelay:     true,
    isRealtime:   true,
  };

  private listeners:      Array<(s: LightningStrike) => void> = [];
  private _connected      = false;
  private ws:             WebSocket | null = null;
  private serverIndex     = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  // Settings kept for reconnect attempts
  private lat    = 48.0;
  private lon    = 11.0;
  private radius = 1000;

  get connected() { return this._connected; }

  async connect(settings: Record<string, string | number>): Promise<void> {
    this.lat    = Number(settings.lat    ?? 48.0);
    this.lon    = Number(settings.lon    ?? 11.0);
    this.radius = Number(settings.radius ?? 1000);
    this.intentionalClose = false;
    this.serverIndex = 0;

    return new Promise<void>((resolve, reject) => {
      this.openSocket(resolve, reject);
    });
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }

  onStrike(cb: (s: LightningStrike) => void)  { this.listeners.push(cb); }
  offStrike(cb: (s: LightningStrike) => void) {
    this.listeners = this.listeners.filter((l) => l !== cb);
  }

  // ----------------------------------------------------------------- socket --

  private openSocket(resolve?: () => void, reject?: (e: Error) => void): void {
    const url     = WS_SERVERS[this.serverIndex % WS_SERVERS.length];
    let settled   = false;

    const settle = (ok: boolean, err?: Error) => {
      if (settled) return;
      settled = true;
      if (ok) resolve?.();
      else    reject?.(err ?? new Error('WebSocket connection failed'));
    };

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      settle(false, e instanceof Error ? e : new Error(String(e)));
      return;
    }

    this.ws.onopen = () => {
      this._connected = true;
      this.ws!.send(JSON.stringify({ a: 111 }));
      settle(true);
    };

    this.ws.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data !== 'string') return;
      try {
        const raw: BzStrike = JSON.parse(lzwDecode(event.data));
        const strike = this.normalise(raw);
        if (strike) this.listeners.forEach((cb) => cb(strike));
      } catch {
        // malformed message — ignore
      }
    };

    this.ws.onerror = () => {
      // onclose fires right after onerror; all handling is done there
    };

    this.ws.onclose = () => {
      this._connected = false;
      if (this.intentionalClose) return;
      // Fail the initial connect promise, then schedule a quiet reconnect
      settle(false, new Error(`Could not connect to ${url}`));
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;
    this.serverIndex++;
    this.reconnectTimer = setTimeout(() => {
      if (!this.intentionalClose) this.openSocket();
    }, 5_000);
  }

  // -------------------------------------------------------------- normalise --

  private normalise(raw: BzStrike): LightningStrike | null {
    // Apply server-provided coordinate corrections if present
    const lat = raw.lat + (raw.latc ?? 0);
    const lon = raw.lon + (raw.lonc ?? 0);

    // Client-side radius filter (radius === 0 means global — no filter)
    if (this.radius > 0 && haversineKm(this.lat, this.lon, lat, lon) > this.radius) {
      return null;
    }

    return {
      id:        `bz-${raw.time}`,
      time:      Math.round(raw.time / 1_000_000), // ns → ms
      lat,
      lon,
      polarity:  0,
      amplitude: 0,
      altitude:  raw.alt   ?? 0,
      delay:     raw.del   ?? raw.delay ?? 0,
      source:    'blitzortung',
    };
  }
}
