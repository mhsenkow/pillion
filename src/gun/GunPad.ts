import { CoopClient } from '../net/coopClient';
import {
  loadGunnerProfile,
  parseCoopQuery,
  saveGunnerProfile,
  type CoopHostSnap,
  type CoopZombieSnap,
} from '../net/coopProtocol';
import { flags } from '../core/flags';
import { applyOutfitPreset, loadGunnerOutfit, type GunnerOutfitPick } from './outfit';
import './gunPad.css';

interface SmoothBike {
  x: number;
  z: number;
  heading: number;
  speed: number;
  hp: number;
  fuel: number;
}

interface SnapBuf {
  snap: CoopHostSnap;
  at: number;
}

/** Phone-only gunner seat. The TV runs the diorama; this page only aims and shoots. */
export class GunPad {
  private root: HTMLElement;
  private client: CoopClient;
  private code: string;
  private statusEl!: HTMLElement;
  private statusWrap!: HTMLElement;
  private vitalsEl!: HTMLElement;
  private objectiveEl!: HTMLElement;
  private placeEl!: HTMLElement;
  private radar!: HTMLCanvasElement;
  private aimPad!: HTMLElement;
  private stick!: HTMLElement;
  private fireBtn!: HTMLButtonElement;
  private autoBtn!: HTMLButtonElement;
  private shootingEl!: HTMLElement;
  private rttEl!: HTMLElement;
  private threatEl!: HTMLElement;
  private heatEl!: HTMLElement;
  private specialBtn!: HTMLButtonElement;
  private weapon = 0 as 0 | 1 | 2;
  private autoFire = true;
  private autoAim = true;
  private fireHeld = false;
  private aiming = false;
  private aimAngle = Math.PI;
  private relativeAim = true;
  private gyroAim = false;
  private heat = 0;
  private specialCd = 0;
  private specialArmed = false;
  private host: CoopHostSnap | null = null;
  private snapBuf: SnapBuf[] = [];
  private lastSend = 0;
  private live = false;
  private rttMs = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private profile = loadGunnerProfile();
  private audioCtx: AudioContext | null = null;
  private lastKill = 0;
  private a11y = false;
  private smooth: SmoothBike = { x: 0, z: 0, heading: 0, speed: 0, hp: 100, fuel: 100 };
  private lastPointer: { x: number; y: number } | null = null;
  private outfit: GunnerOutfitPick = loadGunnerOutfit();

  constructor(root: HTMLElement) {
    this.root = root;
    const code = parseCoopQuery();
    if (!code) {
      this.showJoinGate();
      this.code = '';
      this.client = this.dummyClient();
      return;
    }
    this.code = code;
    this.client = new CoopClient({
      onWelcome: (role) => {
        this.live = true;
        this.setStatus(
          role === 'gunner' ? `CONNECTED · waiting for TV feed` : `SEATED · ${this.code}`,
          false,
        );
        void this.requestWakeLock();
      },
      onPeer: (_role, online) => {
        if (!online) this.setStatus(`WAITING FOR TV · ${this.code}`, false);
      },
      onHost: (snap) => this.ingestHost(snap),
      onGun: () => undefined,
      onDrop: () => undefined,
      onToast: () => undefined,
      onStatus: (text) => {
        if (!this.host) this.setStatus(text, text.includes('LIVE'));
      },
      onEvent: (evt) => {
        if (evt.kind === 'kill') {
          this.pulse(40);
          this.chime(880, 0.05);
        }
        if (evt.kind === 'blast') this.pulse(80);
      },
      onError: (code, text) => {
        if (code === 'ride_full' || code === 'stale') this.showFullRoom(text);
      },
      onRtt: (ms) => {
        this.rttMs = ms;
      },
    });
    this.render();
    this.bind();
    this.client.connect(this.code, 'gunner', {
      seat: this.profile.seat,
      name: this.profile.name,
      color: this.profile.color,
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.requestWakeLock();
        if (!this.client.connected && this.code) {
          this.client.connect(this.code, 'gunner', {
            seat: this.profile.seat,
            name: this.profile.name,
            color: this.profile.color,
          });
        }
      }
    });
    this.loop();
  }

  private showJoinGate(): void {
    this.root.innerHTML = `<div class="gun-shell"><div class="gun-banner"><h1>Missing ride link</h1><p class="sub">On the TV, tap SHARE PHONE GUN or open <a href="/join">/join</a> and type the code.</p><p><a class="gun-btn" href="/join">ENTER CODE</a></p></div></div>`;
  }

  private showFullRoom(text: string): void {
    this.root.innerHTML = `
      <div class="gun-shell">
        <div class="gun-banner">
          <h1>Ride full or expired</h1>
          <p class="sub">${text || 'Ask the TV for a new link.'}</p>
          <a class="gun-btn fire" href="/join">Ask for a new link</a>
        </div>
      </div>`;
  }

  private dummyClient(): CoopClient {
    return new CoopClient({
      onWelcome: () => undefined,
      onPeer: () => undefined,
      onHost: () => undefined,
      onGun: () => undefined,
      onDrop: () => undefined,
      onToast: () => undefined,
      onStatus: () => undefined,
    });
  }

  private async requestWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      /* unsupported / denied */
    }
  }

  private ingestHost(snap: CoopHostSnap): void {
    const now = performance.now() / 1000;
    this.snapBuf.push({ snap, at: now });
    while (this.snapBuf.length > 8) this.snapBuf.shift();
    this.host = snap;
    this.live = true;
    if (snap.kills > this.lastKill) {
      this.lastKill = snap.kills;
      this.pulse(50);
      this.chime(990, 0.06);
    }
    if (!this.aiming && !this.gyroAim) {
      this.aimAngle = snap.aim;
      if (this.autoAim) this.aimNearest(snap);
    }
    this.weapon = snap.weapon;
    this.root.querySelectorAll('.weapon').forEach((el) => {
      const btn = el as HTMLElement;
      btn.classList.toggle('active', parseInt(btn.dataset.w || '0', 10) === this.weapon);
    });
    const age = Math.max(0, now - snap.at);
    this.setStatus(`TV LIVE · ${Math.round(age * 1000)}ms`, true);
    this.placeEl.textContent = snap.place || 'Earth block';
    this.objectiveEl.textContent = snap.objective || '';
    this.shootingEl.classList.toggle('on', !!snap.fire);
  }

  /** Interpolate between buffered snapshots (~100ms delay). */
  private interpolated(): CoopHostSnap | null {
    if (!this.snapBuf.length) return this.host;
    const target = performance.now() / 1000 - 0.1;
    let a = this.snapBuf[0];
    let b = this.snapBuf[this.snapBuf.length - 1];
    for (let i = 0; i < this.snapBuf.length - 1; i++) {
      if (this.snapBuf[i].at <= target && this.snapBuf[i + 1].at >= target) {
        a = this.snapBuf[i];
        b = this.snapBuf[i + 1];
        break;
      }
    }
    const span = Math.max(0.001, b.at - a.at);
    const t = Math.min(1, Math.max(0, (target - a.at) / span));
    const lerp = (x: number, y: number) => x + (y - x) * t;
    const sa = a.snap;
    const sb = b.snap;
    return {
      ...sb,
      bike: {
        ...sb.bike,
        x: lerp(sa.bike.x, sb.bike.x),
        z: lerp(sa.bike.z, sb.bike.z),
        heading: lerp(sa.bike.heading, sb.bike.heading),
        speed: lerp(sa.bike.speed, sb.bike.speed),
        hp: lerp(sa.bike.hp, sb.bike.hp),
        fuel: lerp(sa.bike.fuel, sb.bike.fuel),
      },
      aim: lerp(sa.aim, sb.aim),
    };
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="gun-shell" id="gun-shell">
        <div class="gun-tutorial" id="gun-tutorial">
          <div class="gun-tutorial-card">
            <h2>You're the gunner</h2>
            <p>drag to aim · auto fire is on</p>
            <p class="sub">Name yourself for the TV</p>
            <input id="gun-name" maxlength="16" value="${this.profile.name}" />
            <input id="gun-color" type="color" value="${this.profile.color}" />
            <div class="gun-row" style="justify-content:center;margin:8px 0">
              <button type="button" class="gun-btn" data-outfit="street">STREET</button>
              <button type="button" class="gun-btn" data-outfit="tactical">TACTICAL</button>
              <button type="button" class="gun-btn" data-outfit="nomad">NOMAD</button>
            </div>
            <button type="button" class="gun-btn fire" id="gun-tutorial-go">GOT IT</button>
          </div>
        </div>
        <header class="gun-banner">
          <h1>Gunner pad</h1>
          <p>This phone aims. The TV is the game.</p>
          <p class="sub" id="gun-place">Connecting…</p>
          <div class="gun-status" id="gun-status-wrap"><span class="dot"></span><span id="gun-status">CONNECTING…</span></div>
          <div class="gun-rtt mono" id="gun-rtt"></div>
        </header>
        <div class="gun-vitals" id="gun-vitals">HP — · FUEL — · KILLS — · HORDE —</div>
        <div class="gun-objective mono" id="gun-objective">Waiting for the TV ride…</div>
        <div class="gun-threat" id="gun-threat"></div>
        <div class="gun-stage">
          <div class="gun-radar-wrap">
            <div class="gun-radar-label">LIVE FROM TV</div>
            <div class="gun-shooting" id="gun-shooting">FIRING</div>
            <canvas id="gun-radar" width="420" height="420"></canvas>
          </div>
          <div class="gun-aim" id="gun-aim">
            <div class="gun-aim-hint">DRAG TO AIM<br/>SWIPE ← → WEAPONS</div>
            <div class="gun-stick" id="gun-stick"></div>
          </div>
        </div>
        <div class="gun-heat"><div class="gun-heat-fill" id="gun-heat"></div></div>
        <div class="gun-controls">
          <div class="gun-row">
            <button type="button" class="gun-btn active" id="btn-auto">AUTO FIRE: ON</button>
            <button type="button" class="gun-btn active" id="btn-autoaim">AUTO AIM: ON</button>
            <button type="button" class="gun-btn" id="btn-gyro">GYRO: OFF</button>
            <button type="button" class="gun-btn" id="btn-a11y">A11Y</button>
          </div>
          <div class="gun-weapons">
            <button type="button" class="gun-btn weapon active" data-w="0">1 BREACH</button>
            <button type="button" class="gun-btn weapon" data-w="1">2 TESLA</button>
            <button type="button" class="gun-btn weapon" data-w="2">3 BOMB</button>
          </div>
          <div class="gun-row">
            <button type="button" class="gun-btn special" id="btn-special">FLARE</button>
            <button type="button" class="gun-btn fire" id="btn-fire">HOLD TO FIRE</button>
          </div>
        </div>
        <footer class="gun-footer">Keep this screen awake · watch the TV · code ${this.code}</footer>
      </div>
    `;
    this.statusEl = this.root.querySelector('#gun-status') as HTMLElement;
    this.statusWrap = this.root.querySelector('#gun-status-wrap') as HTMLElement;
    this.vitalsEl = this.root.querySelector('#gun-vitals') as HTMLElement;
    this.objectiveEl = this.root.querySelector('#gun-objective') as HTMLElement;
    this.placeEl = this.root.querySelector('#gun-place') as HTMLElement;
    this.radar = this.root.querySelector('#gun-radar') as HTMLCanvasElement;
    this.aimPad = this.root.querySelector('#gun-aim') as HTMLElement;
    this.stick = this.root.querySelector('#gun-stick') as HTMLElement;
    this.fireBtn = this.root.querySelector('#btn-fire') as HTMLButtonElement;
    this.autoBtn = this.root.querySelector('#btn-auto') as HTMLButtonElement;
    this.shootingEl = this.root.querySelector('#gun-shooting') as HTMLElement;
    this.rttEl = this.root.querySelector('#gun-rtt') as HTMLElement;
    this.threatEl = this.root.querySelector('#gun-threat') as HTMLElement;
    this.heatEl = this.root.querySelector('#gun-heat') as HTMLElement;
    this.specialBtn = this.root.querySelector('#btn-special') as HTMLButtonElement;
    if (localStorage.getItem('pillion.gun.tutorial') === '1') {
      this.root.querySelector('#gun-tutorial')?.classList.add('hidden');
    }
  }

  private bind(): void {
    this.root.querySelectorAll('[data-outfit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.outfit || 'street';
        this.outfit = applyOutfitPreset(id);
        this.profile = { ...this.profile, color: this.outfit.accent };
        const colorEl = this.root.querySelector('#gun-color') as HTMLInputElement | null;
        if (colorEl) colorEl.value = this.outfit.accent;
      });
    });
    this.root.querySelector('#gun-tutorial-go')?.addEventListener('click', () => {
      const name = (this.root.querySelector('#gun-name') as HTMLInputElement)?.value || 'Gunner';
      const color =
        (this.root.querySelector('#gun-color') as HTMLInputElement)?.value || this.outfit.accent || '#38bdf8';
      saveGunnerProfile(name, color);
      this.profile = loadGunnerProfile();
      localStorage.setItem('pillion.gun.tutorial', '1');
      this.root.querySelector('#gun-tutorial')?.classList.add('hidden');
      this.client.send({
        t: 'gun',
        aim: this.aimAngle,
        weapon: this.weapon,
        autoAim: this.autoAim,
        autoFire: this.autoFire,
        fireHeld: false,
        mx: 0,
        mz: 0,
        name: this.profile.name,
        color: this.profile.color,
        seat: this.profile.seat,
      });
    });

    let swipeX0 = 0;
    const onPoint = (clientX: number, clientY: number) => {
      const rect = this.aimPad.getBoundingClientRect();
      if (this.relativeAim && this.lastPointer) {
        const dx = clientX - this.lastPointer.x;
        const dy = clientY - this.lastPointer.y;
        this.aimAngle += dx * 0.008 - dy * 0.002;
        this.lastPointer = { x: clientX, y: clientY };
        const nx = Math.sin(this.aimAngle - this.smooth.heading) * 40;
        const ny = -Math.cos(this.aimAngle - this.smooth.heading) * 40;
        this.stick.style.left = `${50 + (nx / (rect.width / 2)) * 50}%`;
        this.stick.style.top = `${50 + (ny / (rect.height / 2)) * 50}%`;
      } else {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = clientX - cx;
        const dy = clientY - cy;
        const max = Math.min(rect.width, rect.height) * 0.36;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (dx / len) * Math.min(len, max);
        const ny = (dy / len) * Math.min(len, max);
        this.stick.style.left = `${50 + (nx / (rect.width / 2)) * 50}%`;
        this.stick.style.top = `${50 + (ny / (rect.height / 2)) * 50}%`;
        this.aimAngle = this.smooth.heading + Math.atan2(dx, -dy);
        this.lastPointer = { x: clientX, y: clientY };
      }
      this.aiming = true;
      this.autoAim = false;
      const autoAimBtn = this.root.querySelector('#btn-autoaim') as HTMLButtonElement | null;
      if (autoAimBtn) {
        autoAimBtn.textContent = 'AUTO AIM: OFF';
        autoAimBtn.classList.remove('active');
      }
      this.aimPad.classList.add('dragging');
    };

    const endPoint = () => {
      this.aiming = false;
      this.lastPointer = null;
      this.aimPad.classList.remove('dragging');
      this.stick.style.left = '50%';
      this.stick.style.top = '50%';
    };

    this.aimPad.addEventListener('pointerdown', (e) => {
      this.aimPad.setPointerCapture(e.pointerId);
      swipeX0 = e.clientX;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      onPoint(e.clientX, e.clientY);
      this.sendNow();
      this.clickSound();
    });
    this.aimPad.addEventListener('pointermove', (e) => {
      if (!this.aimPad.hasPointerCapture(e.pointerId)) return;
      onPoint(e.clientX, e.clientY);
    });
    this.aimPad.addEventListener('pointerup', (e) => {
      const dx = e.clientX - swipeX0;
      if (Math.abs(dx) > 80 && !this.aiming) {
        this.weapon = ((this.weapon + (dx > 0 ? 1 : 2)) % 3) as 0 | 1 | 2;
        this.root.querySelectorAll('.weapon').forEach((el) => {
          el.classList.toggle('active', parseInt((el as HTMLElement).dataset.w || '0', 10) === this.weapon);
        });
      }
      endPoint();
    });
    this.aimPad.addEventListener('pointercancel', endPoint);

    this.autoBtn.addEventListener('click', () => {
      this.autoFire = !this.autoFire;
      this.autoBtn.textContent = this.autoFire ? 'AUTO FIRE: ON' : 'AUTO FIRE: OFF';
      this.autoBtn.classList.toggle('active', this.autoFire);
      this.sendNow();
    });
    this.root.querySelector('#btn-autoaim')?.addEventListener('click', (e) => {
      this.autoAim = !this.autoAim;
      const btn = e.currentTarget as HTMLButtonElement;
      btn.textContent = this.autoAim ? 'AUTO AIM: ON' : 'AUTO AIM: OFF';
      btn.classList.toggle('active', this.autoAim);
      if (this.autoAim && this.host) this.aimNearest(this.host);
      this.sendNow();
    });
    this.root.querySelector('#btn-gyro')?.addEventListener('click', async (e) => {
      if (!flags().gyroAim) return;
      this.gyroAim = !this.gyroAim;
      const btn = e.currentTarget as HTMLButtonElement;
      btn.textContent = this.gyroAim ? 'GYRO: ON' : 'GYRO: OFF';
      btn.classList.toggle('active', this.gyroAim);
      if (this.gyroAim && typeof DeviceOrientationEvent !== 'undefined') {
        const DOE = DeviceOrientationEvent as unknown as {
          requestPermission?: () => Promise<string>;
        };
        if (DOE.requestPermission) await DOE.requestPermission();
        window.addEventListener('deviceorientation', this.onOrient);
      } else {
        window.removeEventListener('deviceorientation', this.onOrient);
      }
    });
    this.root.querySelector('#btn-a11y')?.addEventListener('click', () => {
      this.a11y = !this.a11y;
      this.root.querySelector('#gun-shell')?.classList.toggle('a11y', this.a11y);
    });
    this.root.querySelectorAll('.weapon').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.weapon = parseInt((btn as HTMLElement).dataset.w || '0', 10) as 0 | 1 | 2;
        this.root.querySelectorAll('.weapon').forEach((el) => el.classList.toggle('active', el === btn));
        this.sendNow();
      });
    });
    this.specialBtn.addEventListener('click', () => {
      if (this.specialCd > 0) return;
      this.specialArmed = true;
      this.specialCd = 12;
      this.pulse(30);
      this.sendNow();
    });
    const setFire = (on: boolean) => {
      this.fireHeld = on;
      this.fireBtn.classList.toggle('held', on);
      if (on) {
        this.pulse(12);
        this.clickSound();
      }
      this.sendNow();
    };
    this.fireBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      setFire(true);
    });
    this.fireBtn.addEventListener('pointerup', () => setFire(false));
    this.fireBtn.addEventListener('pointerleave', () => setFire(false));
    this.fireBtn.addEventListener('pointercancel', () => setFire(false));
  }

  private onOrient = (e: DeviceOrientationEvent): void => {
    if (!this.gyroAim) return;
    const beta = e.beta ?? 0;
    const gamma = e.gamma ?? 0;
    this.aimAngle = this.smooth.heading + (gamma / 45) * 1.2 + (beta - 45) * 0.01;
    this.aiming = true;
  };

  private pulse(ms: number): void {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* ignore */
    }
  }

  private ensureAudio(): AudioContext {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    return this.audioCtx;
  }

  private clickSound(): void {
    try {
      const ctx = this.ensureAudio();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 220;
      g.gain.value = 0.04;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.03);
    } catch {
      /* ignore */
    }
  }

  private chime(freq: number, dur: number): void {
    try {
      const ctx = this.ensureAudio();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.value = 0.05;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + dur);
    } catch {
      /* ignore */
    }
  }

  private aimNearest(snap: CoopHostSnap): void {
    let best: CoopZombieSnap | null = null;
    let bestD = 16;
    for (const z of snap.zombies) {
      const d = Math.hypot(z.x - snap.bike.x, z.z - snap.bike.z);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    if (!best) return;
    this.aimAngle = Math.atan2(best.x - snap.bike.x, best.z - snap.bike.z);
  }

  private updateThreat(snap: CoopHostSnap): void {
    const behind = snap.zombies.find((z) => {
      const ang = Math.atan2(z.x - snap.bike.x, z.z - snap.bike.z);
      let d = ang - snap.bike.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return Math.abs(d) > 2.2 && Math.hypot(z.x - snap.bike.x, z.z - snap.bike.z) < 22;
    });
    if (!behind) {
      this.threatEl.textContent = '';
      this.threatEl.className = 'gun-threat';
      return;
    }
    const ang = Math.atan2(behind.x - snap.bike.x, behind.z - snap.bike.z) - snap.bike.heading;
    this.threatEl.textContent = '⚠ THREAT';
    this.threatEl.className = `gun-threat show ${ang > 0 ? 'right' : 'left'}`;
  }

  private setStatus(text: string, live: boolean): void {
    if (this.statusEl) this.statusEl.textContent = text;
    this.statusWrap?.classList.toggle('live', live);
  }

  private sendNow(): void {
    this.lastSend = 0;
  }

  private pushGun(now: number): void {
    if (!this.client.connected) return;
    if (now - this.lastSend < 1 / 60) return;
    this.lastSend = now;
    const overheated = this.heat >= 1;
    const bike = this.smooth;
    const firing = !overheated && this.fireHeld;
    if (firing || this.autoFire) this.heat = Math.min(1, this.heat + 0.012);
    else this.heat = Math.max(0, this.heat - 0.02);
    if (this.specialCd > 0) this.specialCd -= 1 / 60;
    this.specialBtn.disabled = this.specialCd > 0;
    this.specialBtn.textContent = this.specialCd > 0 ? `FLARE ${this.specialCd.toFixed(0)}s` : 'FLARE';
    this.heatEl.style.width = `${Math.round(this.heat * 100)}%`;
    const special = this.specialArmed;
    this.specialArmed = false;
    this.client.send({
      t: 'gun',
      aim: this.aimAngle,
      weapon: this.weapon,
      autoAim: this.autoAim && !this.aiming,
      autoFire: this.autoFire && !overheated,
      fireHeld: firing,
      mx: bike.x + Math.sin(this.aimAngle) * 10,
      mz: bike.z + Math.cos(this.aimAngle) * 10,
      special,
      name: this.profile.name,
      color: this.profile.color,
      seat: this.profile.seat,
    });
  }

  private tickSmooth(snap: CoopHostSnap): void {
    const t = 0.4;
    this.smooth.x += (snap.bike.x - this.smooth.x) * t;
    this.smooth.z += (snap.bike.z - this.smooth.z) * t;
    this.smooth.speed += (snap.bike.speed - this.smooth.speed) * t;
    this.smooth.hp += (snap.bike.hp - this.smooth.hp) * t;
    this.smooth.fuel += (snap.bike.fuel - this.smooth.fuel) * t;
    let dh = snap.bike.heading - this.smooth.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.smooth.heading += dh * t;
    this.smooth.x += snap.bike.vx * 0.016 * 0.35;
    this.smooth.z += snap.bike.vz * 0.016 * 0.35;
  }

  private loop = (): void => {
    const now = performance.now() / 1000;
    const snap = this.interpolated();
    if (snap) this.tickSmooth(snap);
    if (this.host && now - (this.snapBuf[this.snapBuf.length - 1]?.at ?? 0) > 1.5) {
      this.setStatus(`TV FEED STALE · ${this.code}`, false);
    }
    if (this.host) {
      this.vitalsEl.textContent = `HP ${Math.round(this.smooth.hp)} · FUEL ${Math.round(this.smooth.fuel)} · KILLS ${this.host.kills} · HORDE ${this.host.horde ?? this.host.zombies.length} · ${Math.abs(this.smooth.speed).toFixed(0)} u/s`;
      this.updateThreat(this.host);
    }
    if (this.rttMs > 150) {
      this.rttEl.textContent = `RTT ${Math.round(this.rttMs)}ms`;
      this.rttEl.classList.add('show');
    } else {
      this.rttEl.classList.remove('show');
    }
    this.drawRadar(snap);
    this.pushGun(now);
    requestAnimationFrame(this.loop);
  };

  private drawRadar(snap: CoopHostSnap | null): void {
    const ctx = this.radar.getContext('2d');
    if (!ctx) return;
    const w = this.radar.width;
    const h = this.radar.height;
    ctx.clearRect(0, 0, w, h);
    const grd = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.55);
    grd.addColorStop(0, '#102033');
    grd.addColorStop(1, '#070b12');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    ctx.strokeStyle = 'rgba(148,163,184,0.18)';
    for (const r of [50, 100, 150, 190]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (!snap) {
      ctx.fillStyle = '#64748b';
      ctx.font = '16px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.live ? 'Waiting for TV…' : 'Connecting…', cx, cy);
      return;
    }
    const scale = 10;
    const heading = this.smooth.heading;
    const rot = (x: number, z: number) => {
      const dx = x - this.smooth.x;
      const dz = z - this.smooth.z;
      const c = Math.cos(-heading);
      const s = Math.sin(-heading);
      return { x: cx + (dx * c - dz * s) * scale, y: cy + (dx * s + dz * c) * scale };
    };
    for (const z of snap.zombies) {
      const p = rot(z.x, z.z);
      ctx.fillStyle = z.kind === 'mutant' ? '#d946ef' : z.kind === 'runner' ? '#fb7185' : z.kind === 'tank' ? '#f59e0b' : '#ef4444';
      ctx.beginPath();
      ctx.arc(p.x, p.y, z.kind === 'tank' ? 6 : z.kind === 'mutant' ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of snap.projectiles ?? []) {
      const pt = rot(p.x, p.z);
      ctx.fillStyle = '#fde68a';
      ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    }
    for (const fl of snap.flashes ?? []) {
      const pt = rot(fl.x, fl.z);
      ctx.fillStyle = `rgba(251,146,60,${Math.min(1, fl.life)})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.aimAngle - heading);
    ctx.fillStyle = snap.fire ? 'rgba(251, 113, 133, 0.28)' : 'rgba(251, 191, 36, 0.2)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 170, -0.32, 0.32);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = snap.fire ? '#fb7185' : '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -140);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = this.profile.color || '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx + 9, cy + 10);
    ctx.lineTo(cx - 9, cy + 10);
    ctx.closePath();
    ctx.fill();
  }
}
