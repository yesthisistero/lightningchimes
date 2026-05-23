import type { AudioParams } from '../types/lightning';

export type ReverbType = 'room' | 'hall' | 'canyon';

interface Voice {
  osc: OscillatorNode;
  env: GainNode;
  stopTime: number;         // AudioContext time when voice fully ends
  startedAt: number;        // AudioContext time when voice started
}

const MAX_VOICES = 12;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private initPromise: Promise<void> | null = null;
  private voices: Voice[] = [];
  private currentReverb: ReverbType = 'hall';

  get isRunning() {
    return this.ctx?.state === 'running';
  }

  // ------------------------------------------------------------------ init --

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    if (this.ctx) return;

    this.initPromise = (async () => {
      this.ctx = new AudioContext();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.7;
      this.masterGain.connect(this.ctx.destination);

      this.dryGain = this.ctx.createGain();
      this.dryGain.gain.value = 1;
      this.dryGain.connect(this.masterGain);

      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = 0.5;
      this.reverbGain.connect(this.masterGain);

      this.reverbNode = this.ctx.createConvolver();
      this.reverbNode.connect(this.reverbGain);
      await this.setReverb(this.currentReverb);

      this.initPromise = null;
    })();

    return this.initPromise;
  }

  setMasterVolume(v: number) {
    if (this.masterGain) this.masterGain.gain.value = Math.max(0, Math.min(1, v));
  }

  async resume() {
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
  }

  setupVisibilityListener(): void {
    document.addEventListener('visibilitychange', async () => {
      if (!document.hidden && this.ctx?.state === 'suspended') await this.resume();
    });
  }

  // --------------------------------------------------------------- reverb --

  async setReverb(type: ReverbType): Promise<void> {
    this.currentReverb = type;
    if (!this.ctx || !this.reverbNode) return;
    this.reverbNode.buffer = this.buildImpulse(type);
  }

  private buildImpulse(type: ReverbType): AudioBuffer {
    const ctx = this.ctx!;
    const sampleRate = ctx.sampleRate;

    const configs: Record<ReverbType, { duration: number; decay: number; earlyMs: number }> = {
      room:   { duration: 1.2, decay: 2.0, earlyMs: 8  },
      hall:   { duration: 3.0, decay: 2.5, earlyMs: 20 },
      canyon: { duration: 5.5, decay: 1.6, earlyMs: 60 },
    };
    const { duration, decay, earlyMs } = configs[type];
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(2, length, sampleRate);
    const earlyLen = Math.floor(sampleRate * earlyMs / 1000);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const noise = Math.random() * 2 - 1;
        const envDecay = Math.pow(1 - i / length, decay);
        // Early reflections: higher density at start
        const earlyBoost = i < earlyLen ? 1 + (1 - i / earlyLen) * 2 : 1;
        data[i] = noise * envDecay * earlyBoost;
      }
    }
    return buffer;
  }

  // ------------------------------------------------------ voice stealing --

  private pruneExpiredVoices(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.stopTime > now);
  }

  private stealOldestVoice(): void {
    if (!this.ctx || this.voices.length === 0) return;
    const oldest = this.voices.reduce((a, b) => (a.startedAt < b.startedAt ? a : b));
    const now = this.ctx.currentTime;
    // Graceful 30 ms fade-out before hard stop
    oldest.env.gain.cancelScheduledValues(now);
    oldest.env.gain.setValueAtTime(oldest.env.gain.value, now);
    oldest.env.gain.linearRampToValueAtTime(0, now + 0.03);
    oldest.osc.stop(now + 0.035);
    this.voices = this.voices.filter((v) => v !== oldest);
  }

  private acquireVoiceSlot(): void {
    this.pruneExpiredVoices();
    if (this.voices.length >= MAX_VOICES) this.stealOldestVoice();
  }

  // -------------------------------------------------------- play helpers --

  private applyADSR(env: GainNode, p: AudioParams, now: number): number {
    const { attackTime, decayTime, sustainLevel, releaseTime, gain } = p;
    const sustainGain = gain * Math.max(0, Math.min(1, sustainLevel));
    const totalDuration = attackTime + decayTime + releaseTime;

    env.gain.setValueAtTime(0, now);
    // Attack: 0 → peak
    env.gain.linearRampToValueAtTime(gain, now + attackTime);
    // Decay: peak → sustain
    env.gain.linearRampToValueAtTime(sustainGain, now + attackTime + decayTime);
    // Release: sustain → silence
    env.gain.exponentialRampToValueAtTime(
      0.0001,
      now + attackTime + decayTime + releaseTime
    );

    return totalDuration;
  }

  private buildFilter(ctx: AudioContext, p: AudioParams): BiquadFilterNode {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = p.filterFreq;
    filter.Q.value = p.filterQ ?? 1.2;
    return filter;
  }

  private buildPanner(ctx: AudioContext, pan: number): StereoPannerNode {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    return panner;
  }

  private buildDelay(ctx: AudioContext, delayTime: number): [DelayNode, GainNode] {
    const delay = ctx.createDelay(2);
    delay.delayTime.value = delayTime;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    delay.connect(fb);
    fb.connect(delay);
    return [delay, fb];
  }

  private addTremolo(ctx: AudioContext, envGain: GainNode, depth: number, now: number, duration: number): void {
    const lfo = ctx.createOscillator();
    const lfoAmp = ctx.createGain();
    lfo.frequency.value = 4 + Math.random() * 3;
    lfoAmp.gain.value = depth * 0.08;
    lfo.connect(lfoAmp);
    lfoAmp.connect(envGain.gain);
    lfo.start(now);
    lfo.stop(now + duration);
  }

  // ---------------------------------------------------- standard strike --

  playStrike(params: AudioParams): void {
    if (!this.ctx || this.ctx.state === 'closed' || !this.dryGain || !this.reverbNode) return;

    // FM preset gets its own path
    if (params.fmRatio !== undefined || params.fmIndex !== undefined) {
      this.playFMStrike(params);
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.acquireVoiceSlot();

    const panner = this.buildPanner(ctx, params.pan);
    const filter = this.buildFilter(ctx, params);
    const env = ctx.createGain();
    const duration = this.applyADSR(env, params, now);

    const osc = ctx.createOscillator();
    osc.type = params.waveform;
    osc.frequency.setValueAtTime(params.frequency, now);
    // Subtle pitch sag on longer tones (natural resonator character)
    if (duration > 0.3) {
      osc.frequency.exponentialRampToValueAtTime(params.frequency * 0.97, now + duration);
    }

    if (duration > 0.5) {
      this.addTremolo(ctx, env, params.gain, now, duration);
    }

    // Signal path: osc → env → filter → panner → dry bus
    osc.connect(env);
    env.connect(filter);
    filter.connect(panner);
    panner.connect(this.dryGain);

    // Optional delay send (pre-reverb)
    if (params.delayTime > 0) {
      const [delay] = this.buildDelay(ctx, params.delayTime);
      filter.connect(delay);
      delay.connect(panner);
    }

    // Reverb send scaled by reverbMix
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = params.reverbMix;
    filter.connect(reverbSend);
    reverbSend.connect(this.reverbNode);

    const stopTime = now + duration + 0.05;
    osc.start(now);
    osc.stop(stopTime);

    this.voices.push({ osc, env, stopTime, startedAt: now });
  }

  // --------------------------------------------------------- FM strike --

  private playFMStrike(params: AudioParams): void {
    if (!this.ctx || this.ctx.state === 'closed' || !this.dryGain || !this.reverbNode) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.acquireVoiceSlot();

    const ratio   = params.fmRatio  ?? 2;
    const index   = params.fmIndex  ?? 3;
    const panner  = this.buildPanner(ctx, params.pan);
    const filter  = this.buildFilter(ctx, params);

    // Carrier
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(params.frequency, now);

    // Modulator
    const modulator    = ctx.createOscillator();
    const modGain      = ctx.createGain();
    modulator.frequency.value = params.frequency * ratio;
    modGain.gain.setValueAtTime(params.frequency * index, now);
    // Modulation index decays — creates classic FM "brightness attack"
    modGain.gain.exponentialRampToValueAtTime(
      params.frequency * index * 0.1,
      now + params.attackTime + params.decayTime
    );
    modulator.connect(modGain);
    modGain.connect(carrier.frequency);

    // Amplitude envelope
    const env = ctx.createGain();
    const duration = this.applyADSR(env, params, now);

    carrier.connect(env);
    env.connect(filter);
    filter.connect(panner);
    panner.connect(this.dryGain);

    // Reverb send
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = params.reverbMix;
    filter.connect(reverbSend);
    reverbSend.connect(this.reverbNode);

    const stopTime = now + duration + 0.05;
    carrier.start(now);
    modulator.start(now);
    carrier.stop(stopTime);
    modulator.stop(stopTime);

    this.voices.push({ osc: carrier, env, stopTime, startedAt: now });
  }

  dispose(): void {
    this.ctx?.close();
    this.ctx = null;
    this.voices = [];
  }
}
