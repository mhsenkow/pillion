/** Lightweight procedural SFX via Web Audio — no asset pack required. */

type NoiseKind =
  | 'engine'
  | 'drift'
  | 'fire'
  | 'hit'
  | 'tick'
  | 'toast'
  | 'tow'
  | 'pickup'
  | 'switch'
  | 'hurt'
  | 'kill'
  | 'blast'
  | 'grunt'
  | 'backfire'
  | 'bark';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineLfo: OscillatorNode | null = null;
  private gearGains: GainNode[] = [];
  private gearStarted = false;
  private threatBedGain: GainNode | null = null;
  private threatLayers: { osc: OscillatorNode; gain: GainNode }[] = [];
  private threatStarted = false;
  private lastThreat = 0;
  private unlocked = false;
  private muted = false;
  private lastFire = 0;
  private lastHit = 0;
  private lastTick = 0;
  private lastDrift = 0;
  private lastHeartbeat = 0;
  private lastGrunt = 0;
  private lastBackfire = 0;
  private lastBark = 0;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  unlock(): void {
    if (this.unlocked) return;
    const ctx = this.ensure();
    if (!ctx) return;
    this.unlocked = true;
    this.startEngine();
    this.startThreatBeds();
    this.applyMuteGain();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyMuteGain();
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private applyMuteGain(): void {
    if (!this.master) return;
    this.master.gain.value = this.muted ? 0 : 0.22;
  }

  private startEngine(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.engineOsc) return;

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 280;
    filter.Q.value = 0.7;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    this.engineLfo = ctx.createOscillator();
    this.engineLfo.type = 'sine';
    this.engineLfo.frequency.value = 4;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 8;
    this.engineLfo.connect(lfoGain);
    lfoGain.connect(this.engineOsc.frequency);

    this.engineOsc.connect(filter);
    filter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    this.engineLfo.start();

    const bed = ctx.createGain();
    bed.gain.value = 0.035;
    for (const freq of [55, 82.5]) {
      const tone = ctx.createOscillator();
      tone.type = 'sine';
      tone.frequency.value = freq;
      tone.connect(bed);
      tone.start();
    }
    bed.connect(this.master);
    this.startGearLayers(ctx);
  }

  private startGearLayers(ctx: AudioContext): void {
    if (this.gearStarted || !this.master) return;
    this.gearStarted = true;
    const freqs = [92, 124, 166, 210, 248];
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(this.master);
      osc.start();
      this.gearGains.push(g);
    }
  }

  private startThreatBeds(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.threatStarted) return;
    this.threatStarted = true;
    this.threatBedGain = ctx.createGain();
    this.threatBedGain.gain.value = 0;
    this.threatBedGain.connect(this.master);

    const specs = [
      { type: 'sine' as OscillatorType, freq: 42, q: 0.018 },
      { type: 'triangle' as OscillatorType, freq: 78, q: 0.035 },
      { type: 'sawtooth' as OscillatorType, freq: 156, q: 0.055 },
    ];
    for (const spec of specs) {
      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.frequency.value = spec.freq;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.22 + spec.freq * 0.002;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = spec.q * 40;
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      osc.connect(gain);
      gain.connect(this.threatBedGain);
      osc.start();
      lfo.start();
      this.threatLayers.push({ osc, gain });
    }
  }

  /** Intensity-layered ambient beds for horde pressure (0 calm → 1 siege). */
  updateThreatMusic(threat: number): void {
    if (!this.unlocked || !this.threatBedGain) return;
    const t = Math.min(1, Math.max(0, threat));
    const now = this.ctx!.currentTime;
    this.lastThreat = t;
    this.threatBedGain.gain.setTargetAtTime(0.045 + t * 0.11, now, 0.35);
    const layerGains = [t * 0.35, t * 0.55, t * t * 0.7];
    this.threatLayers.forEach((layer, i) => {
      layer.gain.gain.setTargetAtTime(layerGains[i] ?? 0, now, 0.25);
      layer.osc.frequency.setTargetAtTime((42 + i * 48) * (1 + t * 0.12), now, 0.4);
    });
  }

  getThreatLevel(): number {
    return this.lastThreat;
  }

  updateEngine(speed: number, drifting: boolean, gear = 1): void {
    if (!this.unlocked || !this.engineOsc || !this.engineGain) return;
    const abs = Math.abs(speed);
    const g = Math.min(5, Math.max(1, Math.round(gear)));
    const target = Math.min(0.12, abs * 0.012 + (drifting ? 0.04 : 0) + (g - 1) * 0.008);
    const now = this.ctx!.currentTime;
    this.engineGain.gain.setTargetAtTime(target, now, 0.08);
    this.engineOsc.frequency.setTargetAtTime(48 + abs * 9 + (drifting ? 18 : 0) + g * 6, now, 0.05);
    if (this.gearGains.length) {
      this.gearGains.forEach((gain, i) => {
        const on = i < g - 1 ? 0.025 + abs * 0.004 : 0;
        gain.gain.setTargetAtTime(on, now, 0.12);
      });
    }
    if (drifting && now - this.lastDrift > 0.18) {
      this.lastDrift = now;
      this.beep('drift');
    }
    if (abs > 4.5 && Math.random() < 0.002 * g) this.backfire();
  }

  backfire(): void {
    const now = performance.now() / 1000;
    if (now - this.lastBackfire < 0.35) return;
    this.lastBackfire = now;
    this.beep('backfire');
  }

  fire(): void {
    const now = performance.now() / 1000;
    if (now - this.lastFire < 0.04) return;
    this.lastFire = now;
    this.beep('fire');
  }

  hit(): void {
    const now = performance.now() / 1000;
    if (now - this.lastHit < 0.05) return;
    this.lastHit = now;
    this.beep('hit');
  }

  /** Sharp UI / crosshair tick — lighter than `hit()`. */
  hitTick(): void {
    const now = performance.now() / 1000;
    if (now - this.lastTick < 0.03) return;
    this.lastTick = now;
    this.beep('tick');
  }

  /**
   * Positional zombie groan.
   * @param pan Stereo pan −1 (left) … 1 (right).
   * @param distance World distance; attenuates volume.
   */
  zombieGrunt(pan: number, distance: number): void {
    const now = performance.now() / 1000;
    if (now - this.lastGrunt < 0.12) return;
    this.lastGrunt = now;
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.unlocked) return;
    const t0 = ctx.currentTime;
    const p = Math.min(1, Math.max(-1, pan));
    const dist = Math.max(0.5, distance);
    const vol = Math.min(0.22, 0.65 / (1 + dist * 0.14));

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 120 + Math.random() * 40;
    filter.Q.value = 2.2;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95 + Math.random() * 25, t0);
    osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.22);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.24);
    osc.connect(filter);
    filter.connect(gain);

    const panner = ctx.createStereoPanner?.() ?? null;
    if (panner) {
      panner.pan.value = p;
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      const split = ctx.createGain();
      const left = ctx.createGain();
      const right = ctx.createGain();
      const lp = (1 - p) * 0.5;
      const rp = (1 + p) * 0.5;
      left.gain.value = lp;
      right.gain.value = rp;
      const merger = ctx.createChannelMerger(2);
      gain.connect(split);
      split.connect(left);
      split.connect(right);
      left.connect(merger, 0, 0);
      right.connect(merger, 0, 1);
      merger.connect(this.master);
    }

    osc.start(t0);
    osc.stop(t0 + 0.26);
  }

  /** Radio / partner callout — returns trimmed subtitle text for HUD. */
  bark(text: string): string {
    const now = performance.now() / 1000;
    const line = text.trim().replace(/\s+/g, ' ').slice(0, 72);
    const subtitle = line.length < text.trim().length ? `${line}…` : line;
    if (now - this.lastBark > 0.08) {
      this.lastBark = now;
      this.beep('bark');
    }
    return subtitle || '…';
  }

  blast(): void {
    this.beep('blast');
  }

  toast(): void {
    this.beep('toast');
  }

  tow(): void {
    this.beep('tow');
  }

  pickup(): void {
    this.beep('pickup');
  }

  switchWeapon(): void {
    this.beep('switch');
  }

  hurt(): void {
    this.beep('hurt');
  }

  kill(): void {
    this.beep('kill');
  }

  heartbeat(): void {
    const now = performance.now() / 1000;
    if (now - this.lastHeartbeat < 0.55) return;
    this.lastHeartbeat = now;
    this.beep('hurt');
  }

  private beep(kind: NoiseKind): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.unlocked) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);

    switch (kind) {
      case 'fire':
        osc.type = 'square';
        osc.frequency.setValueAtTime(420, t0);
        osc.frequency.exponentialRampToValueAtTime(140, t0 + 0.08);
        filter.frequency.value = 900;
        gain.gain.setValueAtTime(0.18, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
        osc.start(t0);
        osc.stop(t0 + 0.11);
        break;
      case 'hit':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, t0);
        osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.12);
        filter.frequency.value = 400;
        gain.gain.setValueAtTime(0.2, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
        osc.start(t0);
        osc.stop(t0 + 0.15);
        break;
      case 'tick':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(920, t0);
        filter.frequency.value = 1800;
        gain.gain.setValueAtTime(0.06, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.035);
        osc.start(t0);
        osc.stop(t0 + 0.04);
        break;
      case 'grunt':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(88, t0);
        osc.frequency.exponentialRampToValueAtTime(48, t0 + 0.2);
        filter.frequency.value = 220;
        gain.gain.setValueAtTime(0.1, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
        osc.start(t0);
        osc.stop(t0 + 0.23);
        break;
      case 'backfire':
        osc.type = 'square';
        osc.frequency.setValueAtTime(120, t0);
        osc.frequency.exponentialRampToValueAtTime(32, t0 + 0.12);
        filter.frequency.value = 320;
        gain.gain.setValueAtTime(0.14, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
        osc.start(t0);
        osc.stop(t0 + 0.15);
        break;
      case 'bark':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(340, t0);
        osc.frequency.linearRampToValueAtTime(420, t0 + 0.04);
        filter.frequency.value = 900;
        gain.gain.setValueAtTime(0.05, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
        osc.start(t0);
        osc.stop(t0 + 0.08);
        break;
      case 'drift':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(90, t0);
        filter.frequency.value = 220;
        gain.gain.setValueAtTime(0.06, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
        osc.start(t0);
        osc.stop(t0 + 0.11);
        break;
      case 'toast':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, t0);
        osc.frequency.setValueAtTime(880, t0 + 0.06);
        filter.frequency.value = 1200;
        gain.gain.setValueAtTime(0.1, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
        osc.start(t0);
        osc.stop(t0 + 0.17);
        break;
      case 'tow':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, t0);
        osc.frequency.linearRampToValueAtTime(110, t0 + 0.35);
        filter.frequency.value = 500;
        gain.gain.setValueAtTime(0.14, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
        osc.start(t0);
        osc.stop(t0 + 0.42);
        break;
      case 'pickup':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, t0);
        osc.frequency.exponentialRampToValueAtTime(1040, t0 + 0.12);
        filter.frequency.value = 1600;
        gain.gain.setValueAtTime(0.12, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
        osc.start(t0);
        osc.stop(t0 + 0.16);
        break;
      case 'switch':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, t0);
        osc.frequency.linearRampToValueAtTime(480, t0 + 0.05);
        filter.frequency.value = 900;
        gain.gain.setValueAtTime(0.09, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
        osc.start(t0);
        osc.stop(t0 + 0.09);
        break;
      case 'hurt':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, t0);
        osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.18);
        filter.frequency.value = 280;
        gain.gain.setValueAtTime(0.16, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
        osc.start(t0);
        osc.stop(t0 + 0.21);
        break;
      case 'blast':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, t0);
        osc.frequency.exponentialRampToValueAtTime(36, t0 + 0.28);
        filter.frequency.value = 240;
        gain.gain.setValueAtTime(0.28, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
        osc.start(t0);
        osc.stop(t0 + 0.34);
        break;
      case 'kill':
        osc.type = 'square';
        osc.frequency.setValueAtTime(240, t0);
        osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.1);
        filter.frequency.value = 600;
        gain.gain.setValueAtTime(0.11, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
        osc.start(t0);
        osc.stop(t0 + 0.13);
        break;
      default:
        osc.stop();
    }
  }
}

export const gameAudio = new GameAudio();
