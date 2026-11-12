import { CoopClient } from '../net/coopClient';
import {
  parseCoopQuery,
  type CoopHostSnap,
  type CoopZombieSnap,
} from '../net/coopProtocol';
import './gunPad.css';

interface SmoothBike {
  x: number;
  z: number;
  heading: number;
  speed: number;
  hp: number;
  fuel: number;
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
  private weapon = 0 as 0 | 1 | 2;
  private autoFire = true;
  private autoAim = true;
  private fireHeld = false;
  private aiming = false;
  private aimAngle = Math.PI;
  private host: CoopHostSnap | null = null;
  private prevHost: CoopHostSnap | null = null;
  private hostAt = 0;
  private lastSend = 0;
  private live = false;
  private smooth: SmoothBike = { x: 0, z: 0, heading: 0, speed: 0, hp: 100, fuel: 100 };

  constructor(root: HTMLElement) {
    this.root = root;
    const code = parseCoopQuery();
    if (!code) {
      root.innerHTML = `<div class="gun-shell"><div class="gun-banner"><h1>Missing ride link</h1><p class="sub">On the TV, tap SHARE PHONE GUN and send the new link here.</p></div></div>`;
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
    });
    this.render();
    this.bind();
    this.client.connect(this.code, 'gunner');
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.client.connected && this.code) {
        this.client.connect(this.code, 'gunner');
      }
    });
    this.loop();
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

  private ingestHost(snap: CoopHostSnap): void {
    this.prevHost = this.host;
    this.host = snap;
    this.hostAt = performance.now() / 1000;
    this.live = true;
    if (!this.aiming) {
      // Stay locked to whatever the TV is actually aiming at.
      this.aimAngle = snap.aim;
      if (this.autoAim) this.aimNearest(snap);
    }
    this.weapon = snap.weapon;
    this.root.querySelectorAll('.weapon').forEach((el) => {
      const btn = el as HTMLElement;
      btn.classList.toggle('active', parseInt(btn.dataset.w || '0', 10) === this.weapon);
    });
    const age = Math.max(0, performance.now() / 1000 - snap.at);
    this.setStatus(`TV LIVE · ${Math.round(age * 1000)}ms`, true);
    this.placeEl.textContent = snap.place || 'Earth block';
    this.objectiveEl.textContent = snap.objective || '';
    this.shootingEl.classList.toggle('on', !!snap.fire);
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="gun-shell">
        <header class="gun-banner">
          <h1>Gunner pad</h1>
          <p>This phone aims. The TV is the game.</p>
          <p class="sub" id="gun-place">Connecting…</p>
          <div class="gun-status" id="gun-status-wrap"><span class="dot"></span><span id="gun-status">CONNECTING…</span></div>
        </header>
        <div class="gun-vitals" id="gun-vitals">HP — · FUEL — · KILLS — · HORDE —</div>
        <div class="gun-objective mono" id="gun-objective">Waiting for the TV ride…</div>
        <div class="gun-stage">
          <div class="gun-radar-wrap">
            <div class="gun-radar-label">LIVE FROM TV</div>
            <div class="gun-shooting" id="gun-shooting">FIRING</div>
            <canvas id="gun-radar" width="420" height="420"></canvas>
          </div>
          <div class="gun-aim" id="gun-aim">
            <div class="gun-aim-hint">DRAG TO AIM<br/>AUTO AIM FOLLOWS THREATS</div>
            <div class="gun-stick" id="gun-stick"></div>
          </div>
        </div>
        <div class="gun-controls">
          <div class="gun-row">
            <button type="button" class="gun-btn active" id="btn-auto">AUTO FIRE: ON</button>
            <button type="button" class="gun-btn active" id="btn-autoaim">AUTO AIM: ON</button>
          </div>
          <div class="gun-weapons">
            <button type="button" class="gun-btn weapon active" data-w="0">1 BREACH</button>
            <button type="button" class="gun-btn weapon" data-w="1">2 TESLA</button>
            <button type="button" class="gun-btn weapon" data-w="2">3 BOMB</button>
          </div>
          <button type="button" class="gun-btn fire" id="btn-fire">HOLD TO FIRE</button>
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
  }

  private bind(): void {
    const onPoint = (clientX: number, clientY: number) => {
      const rect = this.aimPad.getBoundingClientRect();
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
      const stickAngle = Math.atan2(dx, -dy);
      this.aimAngle = this.smooth.heading + stickAngle;
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
      this.aimPad.classList.remove('dragging');
      this.stick.style.left = '50%';
      this.stick.style.top = '50%';
    };

    this.aimPad.addEventListener('pointerdown', (e) => {
      this.aimPad.setPointerCapture(e.pointerId);
      onPoint(e.clientX, e.clientY);
      this.sendNow();
    });
    this.aimPad.addEventListener('pointermove', (e) => {
      if (!this.aimPad.hasPointerCapture(e.pointerId)) return;
      onPoint(e.clientX, e.clientY);
    });
    this.aimPad.addEventListener('pointerup', endPoint);
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
    this.root.querySelectorAll('.weapon').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.weapon = parseInt((btn as HTMLElement).dataset.w || '0', 10) as 0 | 1 | 2;
        this.root.querySelectorAll('.weapon').forEach((el) => el.classList.toggle('active', el === btn));
        this.sendNow();
      });
    });
    const setFire = (on: boolean) => {
      this.fireHeld = on;
      this.fireBtn.classList.toggle('held', on);
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

  private setStatus(text: string, live: boolean): void {
    if (this.statusEl) this.statusEl.textContent = text;
    this.statusWrap?.classList.toggle('live', live);
  }

  private sendNow(): void {
    this.lastSend = 0;
  }

  private pushGun(now: number): void {
    if (!this.client.connected) return;
    if (now - this.lastSend < 0.032) return;
    this.lastSend = now;
    const bike = this.smooth;
    this.client.send({
      t: 'gun',
      aim: this.aimAngle,
      weapon: this.weapon,
      autoAim: this.autoAim && !this.aiming,
      autoFire: this.autoFire,
      fireHeld: this.fireHeld,
      mx: bike.x + Math.sin(this.aimAngle) * 10,
      mz: bike.z + Math.cos(this.aimAngle) * 10,
    });
  }

  private tickSmooth(): void {
    const snap = this.host;
    if (!snap) return;
    const t = 0.35;
    this.smooth.x += (snap.bike.x - this.smooth.x) * t;
    this.smooth.z += (snap.bike.z - this.smooth.z) * t;
    this.smooth.speed += (snap.bike.speed - this.smooth.speed) * t;
    this.smooth.hp += (snap.bike.hp - this.smooth.hp) * t;
    this.smooth.fuel += (snap.bike.fuel - this.smooth.fuel) * t;
    // Shortest-path heading lerp
    let dh = snap.bike.heading - this.smooth.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.smooth.heading += dh * t;
    // Extrapolate a little with velocity so motion feels continuous between packets.
    this.smooth.x += snap.bike.vx * 0.016 * 0.35;
    this.smooth.z += snap.bike.vz * 0.016 * 0.35;
  }

  private loop = (): void => {
    const now = performance.now() / 1000;
    this.tickSmooth();
    if (this.host && now - this.hostAt > 1.5) {
      this.setStatus(`TV FEED STALE · ${this.code}`, false);
    }
    if (this.host) {
      this.vitalsEl.textContent = `HP ${Math.round(this.smooth.hp)} · FUEL ${Math.round(this.smooth.fuel)} · KILLS ${this.host.kills} · HORDE ${this.host.horde ?? this.host.zombies.length} · ${Math.abs(this.smooth.speed).toFixed(0)} u/s`;
    }
    this.drawRadar();
    this.pushGun(now);
    requestAnimationFrame(this.loop);
  };

  private drawRadar(): void {
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
    ctx.lineWidth = 1;
    for (const r of [50, 100, 150, 190]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const snap = this.host;
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
    // Motion streak
    ctx.strokeStyle = 'rgba(56,189,248,0.35)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - snap.bike.vx * 2.2, cy - snap.bike.vz * 2.2);
    ctx.stroke();

    for (const z of snap.zombies) {
      const p = rot(z.x, z.z);
      ctx.fillStyle = z.kind === 'mutant' ? '#d946ef' : z.kind === 'runner' ? '#fb7185' : '#ef4444';
      ctx.beginPath();
      ctx.arc(p.x, p.y, z.kind === 'mutant' ? 5 : 3.5, 0, Math.PI * 2);
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

    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx + 9, cy + 10);
    ctx.lineTo(cx - 9, cy + 10);
    ctx.closePath();
    ctx.fill();
    if (snap.bike.drifting) {
      ctx.strokeStyle = '#fde68a';
      ctx.stroke();
    }
  }
}
