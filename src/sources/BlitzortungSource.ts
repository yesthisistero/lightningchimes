import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { encode as encodeGeohash, neighbors as geohashNeighbors } from 'ngeohash';
import type { IDataSource, SourceCapabilities } from './IDataSource';
import type { LightningStrike, SourceConfig } from '../types/lightning';

// Blitzortung MQTT data format (raw from broker)
interface BlitzortungStrike {
  time: number;  // nanoseconds since epoch
  lat: number;
  lon: number;
  alt: number;
  pol: number;   // polarity
  mds: number;
  mcg: number;
  status: number;
  region: number;
  delay?: number;
}

// Primary MQTT broker (public community server at blitzortung.ha.sed.pl)
// Fallbacks: others can be added for resilience
const DEFAULT_MQTT_URL = 'mqtt://blitzortung.ha.sed.pl:1883';
// Note: wss:// endpoints may work if the broker supports WebSocket.
// Common alt ports for WebSocket MQTT: 8080, 8083, 9001, 443/wss
const GEOHASH_PRECISION = 2;

export const blitzortungConfig: SourceConfig = {
  id: 'blitzortung',
  label: 'Blitzortung (Live)',
  description: 'Free community lightning network via MQTT. Global real-time data, ~1–5s latency.',
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
      key: 'precision',
      label: 'Geohash Precision (1–4)',
      type: 'number',
      default: GEOHASH_PRECISION,
      placeholder: '2',
    },
    {
      key: 'mqttUrl',
      label: 'MQTT Broker URL (advanced)',
      type: 'text',
      default: DEFAULT_MQTT_URL,
      placeholder: 'mqtt://blitzortung.ha.sed.pl:1883',
    },
  ],
};

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'error';

export class BlitzortungSource implements IDataSource {
  readonly config = blitzortungConfig;
  readonly capabilities: SourceCapabilities = {
    hasPolarity:  true,
    hasAmplitude: false, // Blitzortung does not expose amplitude publicly
    hasAltitude:  false,
    hasDelay:     true,
    isRealtime:   true,
  };
  private client: MqttClient | null = null;
  private listeners: Array<(s: LightningStrike) => void> = [];
  private statusListeners: Array<(status: ConnectionStatus, message: string) => void> = [];
  private _connected = false;

  get connected() {
    return this._connected;
  }

  onConnectionStatusChange(cb: (status: ConnectionStatus, message: string) => void): void {
    this.statusListeners.push(cb);
  }

  offConnectionStatusChange(cb: (status: ConnectionStatus, message: string) => void): void {
    this.statusListeners = this.statusListeners.filter((l) => l !== cb);
  }

  private emitStatus(status: ConnectionStatus, message: string): void {
    this.statusListeners.forEach((cb) => cb(status, message));
  }

  async connect(settings: Record<string, string | number>): Promise<void> {
    const lat = Number(settings.lat ?? 48.0);
    const lon = Number(settings.lon ?? 11.0);
    const precision = Math.min(4, Math.max(1, Number(settings.precision ?? GEOHASH_PRECISION)));
    const mqttUrl = String(settings.mqttUrl ?? DEFAULT_MQTT_URL);
    const geohash = encodeGeohash(lat, lon, precision);
    // Centre cell + all 8 surrounding neighbours for a wider listening area
    // ngeohash returns [n, ne, e, se, s, sw, w, nw]
    const cells = [geohash, ...geohashNeighbors(geohash)];
    const topics = cells.map((cell) => `blitzortung/1.1/${cell}/#`);

    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(mqttUrl, {
        clientId: `lightning-chime-${Math.random().toString(16).slice(2, 8)}`,
        clean: true,
        reconnectPeriod: 5000,
      });

      let isFirstConnect = true;

      this.client.on('connect', () => {
        this._connected = true;
        if (isFirstConnect) {
          this.emitStatus('connecting', `Subscribing to ${topics.length} geohash cells...`);
          isFirstConnect = false;
          this.client!.subscribe(topics, (err) => {
            if (err) {
              reject(err);
            } else {
              this.emitStatus('connected', `Connected · monitoring ${topics.length} cells`);
              resolve();
            }
          });
        } else {
          this.emitStatus('connected', 'Reconnected to MQTT broker');
        }
      });

      this.client.on('reconnect', () => {
        this.emitStatus('reconnecting', 'Attempting to reconnect...');
      });

      this.client.on('offline', () => {
        this._connected = false;
        this.emitStatus('offline', 'MQTT broker offline');
      });

      this.client.on('close', () => {
        this._connected = false;
      });

      this.client.on('error', (err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        let helpText = '';

        // Provide helpful context based on error type
        if (errMsg.includes('ECONNREFUSED') || errMsg.includes('ENOTFOUND')) {
          helpText = ' (Connection refused. Check the MQTT URL and internet connection.)';
        } else if (errMsg.includes('timeout')) {
          helpText = ' (Connection timeout. The broker may be down or unreachable.)';
        } else if (errMsg.includes('CORS') || errMsg.includes('WebSocket')) {
          helpText = ' (WebSocket connection failed. Try a different MQTT broker URL.)';
        }

        const fullMessage = `MQTT connection error: ${errMsg}${helpText}`;
        this.emitStatus('error', fullMessage);
        if (isFirstConnect) {
          isFirstConnect = false;
          reject(new Error(fullMessage));
        }
      });

      this.client.on('message', (_topic: string, payload: Buffer) => {
        try {
          const raw: BlitzortungStrike = JSON.parse(payload.toString());
          const strike = this.normalize(raw);
          this.listeners.forEach((cb) => cb(strike));
        } catch {
          // malformed message — skip
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.client) { resolve(); return; }
      this.client.end(false, {}, () => {
        this._connected = false;
        this.client = null;
        resolve();
      });
    });
  }

  onStrike(cb: (s: LightningStrike) => void) {
    this.listeners.push(cb);
  }

  offStrike(cb: (s: LightningStrike) => void) {
    this.listeners = this.listeners.filter((l) => l !== cb);
  }

  private normalize(raw: BlitzortungStrike): LightningStrike {
    return {
      id: `bz-${raw.time}`,
      time: Math.round(raw.time / 1_000_000), // ns → ms
      lat: raw.lat,
      lon: raw.lon,
      polarity: raw.pol === 1 ? 1 : raw.pol === -1 ? -1 : 0,
      amplitude: 0, // Blitzortung does not expose amplitude publicly
      altitude: raw.alt ?? 0,
      delay: raw.delay ?? 0,
      source: 'blitzortung',
    };
  }
}
