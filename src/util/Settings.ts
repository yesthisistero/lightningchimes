import type { Preset, Scale } from '../audio/SoundMapper';
import type { ReverbType } from '../audio/AudioEngine';
import { DEFAULT_MAPPING } from '../types/mapping';
import type { MappingConfig } from '../types/mapping';

export interface AppSettings {
  lastSourceId: string;
  preset: Preset;
  scale: Scale;
  rootMidi: number;
  octaves: number;
  reverbType: ReverbType;
  volume: number;
  centerLat: number;
  centerLon: number;
  sourceSettings: Record<string, Record<string, string | number>>;
  mappingConfigs: Record<string, MappingConfig>;  // keyed by Preset
}

const STORAGE_KEY = 'lightning-chime:settings';

const DEFAULTS: AppSettings = {
  lastSourceId: 'simulated',
  preset: 'windchime',
  scale: 'pentatonic',
  rootMidi: 60,
  octaves: 2,
  reverbType: 'hall',
  volume: 0.7,
  centerLat: 48.0,
  centerLon: 11.0,
  sourceSettings: {},
  mappingConfigs: {},
};

export class Settings {
  private static data: AppSettings | null = null;

  static load(): AppSettings {
    if (this.data !== null) return this.data;
    let loaded: AppSettings = { ...DEFAULTS };
    try {
      const json = localStorage.getItem(STORAGE_KEY);
      if (json) loaded = { ...DEFAULTS, ...JSON.parse(json) };
    } catch {
      // Ignore parse errors, use defaults
    }
    this.data = loaded;
    return this.data;
  }

  static save(settings: Partial<AppSettings>): void {
    const current = this.load();
    this.data = { ...current, ...settings };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Quota exceeded or private browsing — silently fail
    }
  }

  static getSourceSettings(sourceId: string): Record<string, string | number> {
    const current = this.load();
    return current.sourceSettings[sourceId] ?? {};
  }

  static setSourceSettings(sourceId: string, settings: Record<string, string | number>): void {
    const current = this.load();
    current.sourceSettings[sourceId] = settings;
    this.save({ sourceSettings: current.sourceSettings });
  }

  static getMappingConfig(preset: string): MappingConfig {
    const current = this.load();
    return current.mappingConfigs[preset] ?? { ...DEFAULT_MAPPING };
  }

  static setMappingConfig(preset: string, mapping: MappingConfig): void {
    const current = this.load();
    current.mappingConfigs[preset] = mapping;
    this.save({ mappingConfigs: current.mappingConfigs });
  }

  static clear(): void {
    this.data = DEFAULTS;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Silently fail
    }
  }
}
