export interface LightningStrike {
  id: string;
  time: number;       // ms since epoch
  lat: number;
  lon: number;
  polarity: number;   // -1 = negative, 0 = unknown, 1 = positive
  amplitude: number;  // kA (0–300); 0 if unknown
  altitude: number;   // meters above ground; 0 if unknown
  delay: number;      // detection latency in seconds; 0 if unknown
  source: string;     // source id
}

export interface SourceConfig {
  id: string;
  label: string;
  description: string;
  fields: SourceField[];
}

export interface SourceField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  default: string | number;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export interface AudioParams {
  frequency: number;       // Hz
  waveform: OscillatorType;
  gain: number;            // 0–1  (peak amplitude)
  pan: number;             // -1 (left) to 1 (right)
  reverbMix: number;       // 0–1
  delayTime: number;       // seconds
  filterFreq: number;      // Hz cutoff
  filterQ: number;         // resonance (default 1)
  // Full ADSR envelope
  attackTime: number;      // seconds: 0 → peak
  decayTime: number;       // seconds: peak → sustain level
  sustainLevel: number;    // 0–1: fraction of peak held during sustain
  releaseTime: number;     // seconds: sustain → 0 after note-off
  // FM-specific (ignored by non-FM presets)
  fmRatio?: number;        // carrier : modulator frequency ratio
  fmIndex?: number;        // modulation index (depth)
}
