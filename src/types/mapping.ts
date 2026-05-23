import type { Preset, Scale } from '../audio/SoundMapper';

/**
 * Per-preset mapping overrides applied on top of each preset's own calculations.
 * All values are multipliers or offsets — the preset baseline is always 1× / 0.
 */
export interface MappingConfig {
  gainMult:      number;  // 0.1 – 2.0  — scales peak gain up or down
  reverbOffset:  number;  // -0.5 – 0.5 — shifts the reverb wet mix
  panWidth:      number;  // 0.0 – 2.0  — scales stereo spread (0 = mono, 2 = extra wide)
  pitchShift:    number;  // -24 – +24  — semitones added to every note
  attackMult:    number;  // 0.25 – 4.0 — scales attack time
  envelopeMult:  number;  // 0.25 – 4.0 — scales decay + release times
}

export const DEFAULT_MAPPING: MappingConfig = {
  gainMult:     1.0,
  reverbOffset: 0.0,
  panWidth:     1.0,
  pitchShift:   0,
  attackMult:   1.0,
  envelopeMult: 1.0,
};

/** A saveable snapshot — the full sound configuration at a point in time. */
export interface MappingSnapshot {
  version:  1;
  name:     string;
  savedAt:  string;        // ISO-8601
  preset:   Preset;
  scale:    Scale;
  rootMidi: number;
  octaves?: number;        // optional for backward compat; defaults to 2 on load
  mapping:  MappingConfig;
}
