/** Lightweight procedural SFX via Web Audio — no asset pack required. */

type NoiseKind = 'engine' | 'drift' | 'fire' | 'hit' | 'toast' | 'tow' | 'pickup' | 'switch' | 'hurt' | 'kill' | 'blast';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineLfo: OscillatorNode | null = null;
  private unlocked = false;
  private muted = false;
  private lastFire = 0;
  private lastHit = 0;
  private lastDrift = 0;
  private lastHeartbeat = 0;

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
  }

  updateEngine(speed: number, drifting: boolean): void {
    if (!this.unlocked || !this.engineOsc || !this.engineGain) return;
    const abs = Math.abs(speed);
    const target = Math.min(0.12, abs * 0.012 + (drifting ? 0.04 : 0));
    const now = this.ctx!.currentTime;
    this.engineGain.gain.setTargetAtTime(target, now, 0.08);
    this.engineOsc.frequency.setTargetAtTime(48 + abs * 9 + (drifting ? 18 : 0), now, 0.05);
    if (drifting && now - this.lastDrift > 0.18) {
      this.lastDrift = now;
      this.beep('drift');
    }
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
