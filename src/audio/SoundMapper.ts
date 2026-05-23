import type { LightningStrike, AudioParams } from '../types/lightning';
import type { SourceCapabilities } from '../sources/IDataSource';
import { DEFAULT_MAPPING } from '../types/mapping';
import type { MappingConfig } from '../types/mapping';

export type Preset = 'windchime' | 'theremin' | 'percussion' | 'bells' | 'fm';
export type Scale =
  // Traditional scales / modes
  | 'pentatonic'
  | 'wholetone'
  | 'just'
  | 'lydian'
  | 'chromatic'
  // Chord pools — every note belongs to the same harmony
  | 'maj7add9'
  | 'min9'
  | 'dim7'
  | 'opensus';

// ----------------------------------------------------------------- scales --

const SCALES: Record<Scale, number[]> = {
  // Semitone intervals from root — keep within one octave (0–11)
  pentatonic: [0, 2, 4, 7, 9],             // C D E G A  — universal, warm
  wholetone:  [0, 2, 4, 6, 8, 10],         // C D E F# G# A# — dreamy, symmetric
  just:       [0, 2, 4, 5, 7, 9, 11],      // Ionian (major) in just-ish tuning
  lydian:     [0, 2, 4, 6, 7, 9, 11],      // C D E F# G A B — bright, floating
  chromatic:  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],

  // Chord pools
  maj7add9:   [0, 2, 4, 7, 11],            // C D E G B  — Cmaj9, lush & modern
  min9:       [0, 2, 3, 7, 10],            // C D Eb G Bb — Cmin9, melancholic
  dim7:       [0, 3, 6, 9],                // C Eb Gb A  — symmetric dim7, eerie
  opensus:    [0, 2, 5, 7],               // C D F G    — sus2+sus4, tonally open
};

// Build a note pool from a scale spanning `octaves` octaves, starting at rootMidi.
function buildNoteTable(scale: Scale, rootMidi: number, octaves: number): number[] {
  const intervals = SCALES[scale];
  const notes: number[] = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const interval of intervals) {
      notes.push(rootMidi + oct * 12 + interval);
    }
  }
  return notes;
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Bell harmonic series (inharmonic partials typical of struck metal)
const BELL_MIDI: number[] = [57, 69, 76, 83, 88]; // A3, A4, E5, B5, E6

// Full capabilities (used by Simulated source — all fields available)
const FULL_CAPABILITIES: SourceCapabilities = {
  hasPolarity: true, hasAmplitude: true, hasAltitude: true, hasDelay: true, isRealtime: true,
};

export class SoundMapper {
  private preset: Preset = 'windchime';
  private scale: Scale   = 'pentatonic';
  private rootMidi = 60; // C4
  private octaves  = 2;  // how many octaves the note pool spans
  private centerLon = 0;
  private caps: SourceCapabilities = FULL_CAPABILITIES;
  private mapping: MappingConfig = { ...DEFAULT_MAPPING };

  setPreset(p: Preset)    { this.preset = p; }
  setScale(s: Scale)      { this.scale = s; }
  setRootMidi(m: number)  { this.rootMidi = m; }
  setOctaves(n: number)   { this.octaves = Math.max(1, Math.min(4, n)); }
  setCenter(_lat: number, lon: number) { this.centerLon = lon; }
  setCapabilities(c: SourceCapabilities) { this.caps = c; }
  setMapping(m: MappingConfig) { this.mapping = m; }

  getPreset()   { return this.preset; }
  getScale()    { return this.scale; }
  getRootMidi() { return this.rootMidi; }
  getOctaves()  { return this.octaves; }
  getMapping()  { return { ...this.mapping }; }

  /** Normalise a strike against capabilities before mapping. */
  private normalise(s: LightningStrike): LightningStrike {
    return {
      ...s,
      polarity:  this.caps.hasPolarity  ? s.polarity  : 0,
      amplitude: this.caps.hasAmplitude ? s.amplitude : 80,  // mid-range fallback
      altitude:  this.caps.hasAltitude  ? s.altitude  : 0,
      delay:     this.caps.hasDelay     ? s.delay     : 1,
    };
  }

  map(strike: LightningStrike): AudioParams {
    const s = this.normalise(strike);
    let params: AudioParams;
    switch (this.preset) {
      case 'windchime':  params = this.mapWindChime(s); break;
      case 'theremin':   params = this.mapTheremin(s);  break;
      case 'percussion': params = this.mapPercussion(s); break;
      case 'bells':      params = this.mapBells(s);     break;
      case 'fm':         params = this.mapFM(s);        break;
    }
    return this.applyMapping(params!);
  }

  /** Apply MappingConfig as a post-processing layer on top of preset output. */
  private applyMapping(p: AudioParams): AudioParams {
    const m = this.mapping;
    return {
      ...p,
      gain:         clamp(p.gain * m.gainMult, 0, 1),
      reverbMix:    clamp(p.reverbMix + m.reverbOffset, 0, 1),
      pan:          clamp(p.pan * m.panWidth, -1, 1),
      frequency:    p.frequency * Math.pow(2, m.pitchShift / 12),
      attackTime:   p.attackTime  * m.attackMult,
      decayTime:    p.decayTime   * m.envelopeMult,
      releaseTime:  p.releaseTime * m.envelopeMult,
      // FM carrier frequency must also shift
      ...(p.fmRatio !== undefined && {
        // fmRatio stays the same; carrier frequency already shifted above
      }),
    };
  }

  // --------------------------------------------------------------- presets --

  private mapWindChime(s: LightningStrike): AudioParams {
    const notes   = buildNoteTable(this.scale, this.rootMidi, this.octaves);
    const idx     = Math.abs(Math.floor(s.lat * 7 + s.lon * 3)) % notes.length;
    const base    = midiToHz(notes[idx]);
    const freq    = s.polarity === 1 ? base * 2 : base; // positive → octave up
    const waveform: OscillatorType = s.polarity === 1 ? 'triangle' : 'sine';
    const gain    = this.ampToGain(s.amplitude, 0.2, 0.6);
    const reverb  = clamp(0.2 + s.delay / 6, 0.15, 0.85);
    const release = 1.2 + (s.altitude / 8000) * 1.2;

    return {
      frequency: freq,
      waveform,
      gain,
      pan:          this.lonToPan(s.lon),
      reverbMix:    reverb,
      delayTime:    0,
      filterFreq:   s.polarity === 1 ? 7000 : 3500,
      filterQ:      1.0,
      attackTime:   0.004,
      decayTime:    0.08,
      sustainLevel: 0.55,
      releaseTime:  release,
    };
  }

  private mapTheremin(s: LightningStrike): AudioParams {
    // Latitude maps pitch across 3 octaves (C2–C5)
    const latNorm = clamp((s.lat + 90) / 180, 0, 1);
    const freq    = 65.4 * Math.pow(8, latNorm);
    const gain    = this.ampToGain(s.amplitude, 0.1, 0.4);

    return {
      frequency:    freq,
      waveform:     'sawtooth',
      gain,
      pan:          this.lonToPan(s.lon),
      reverbMix:    0.45,
      delayTime:    s.polarity === 1 ? 0.22 : 0,
      filterFreq:   900 + this.ampToGain(s.amplitude, 0, 1) * 3500,
      filterQ:      2.5,
      attackTime:   0.025,
      decayTime:    0.1,
      sustainLevel: 0.7,
      releaseTime:  0.5 + s.delay * 0.08,
    };
  }

  private mapPercussion(s: LightningStrike): AudioParams {
    const isHeavy = s.amplitude > 80 || (s.amplitude === 0 && Math.random() > 0.5);
    const gain    = this.ampToGain(s.amplitude, 0.35, 0.9);

    return {
      frequency:    isHeavy ? 55 + Math.random() * 35 : 3200 + Math.random() * 4800,
      waveform:     isHeavy ? 'sine' : 'square',
      gain,
      pan:          this.lonToPan(s.lon),
      reverbMix:    isHeavy ? 0.25 : 0.08,
      delayTime:    0,
      filterFreq:   isHeavy ? 220 : 9000,
      filterQ:      isHeavy ? 4.0 : 0.8,
      attackTime:   0.001,
      decayTime:    isHeavy ? 0.18 : 0.03,
      sustainLevel: 0,          // full percussive decay — no sustain
      releaseTime:  isHeavy ? 0.25 : 0.05,
    };
  }

  private mapBells(s: LightningStrike): AudioParams {
    const idx   = Math.abs(Math.floor(s.lat * 7 + s.lon * 3)) % BELL_MIDI.length;
    const base  = midiToHz(BELL_MIDI[idx]);
    const freq  = s.polarity === -1 ? base : base * 1.498; // perfect fifth up
    const gain  = this.ampToGain(s.amplitude, 0.18, 0.55);
    // Quieter strikes ring longer
    const ring  = 2.0 + (1 - clamp(s.amplitude / 200, 0, 1)) * 3.0;

    return {
      frequency:    freq,
      waveform:     'sine',
      gain,
      pan:          this.lonToPan(s.lon),
      reverbMix:    0.72,
      delayTime:    0,
      filterFreq:   6000,
      filterQ:      0.8,
      attackTime:   0.002,
      decayTime:    0.12,
      sustainLevel: 0.4,
      releaseTime:  ring,
    };
  }

  private mapFM(s: LightningStrike): AudioParams {
    const notes    = buildNoteTable(this.scale, this.rootMidi - 12, this.octaves); // one octave lower base
    const idx      = Math.abs(Math.floor(s.lat * 5 + s.lon * 2)) % notes.length;
    const freq     = midiToHz(notes[idx]);
    const normAmp  = clamp(s.amplitude / 200, 0, 1);

    // Amplitude → modulation index: more current = harsher, brighter timbre
    const fmIndex  = 0.5 + normAmp * 8;

    // Polarity → C:M ratio
    // Negative: 1:1 (pure sine-like, vowel quality)
    // Positive: 1:2.5 (metallic, inharmonic partials)
    const fmRatio  = s.polarity === 1 ? 2.5 : 1.0;
    const gain     = this.ampToGain(s.amplitude, 0.15, 0.55);
    const decay    = 0.3 + normAmp * 0.8;

    return {
      frequency:    freq,
      waveform:     'sine', // ignored in FM path, required by type
      fmRatio,
      fmIndex,
      gain,
      pan:          this.lonToPan(s.lon),
      reverbMix:    0.38,
      delayTime:    s.delay > 1 ? 0.18 : 0,
      filterFreq:   8000,
      filterQ:      1.0,
      attackTime:   0.008,
      decayTime:    decay,
      sustainLevel: 0.2,
      releaseTime:  0.4 + s.delay * 0.05,
    };
  }

  // ---------------------------------------------------------------- utils --

  private ampToGain(amplitude: number, min: number, max: number): number {
    if (amplitude <= 0) return (min + max) / 2;
    return min + clamp(amplitude / 200, 0, 1) * (max - min);
  }

  private lonToPan(lon: number): number {
    return clamp((lon - this.centerLon) / 20, -1, 1);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
