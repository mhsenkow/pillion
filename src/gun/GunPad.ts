import { CoopClient } from '../net/coopClient';
import {
  parseCoopQuery,
  type CoopHostSnap,
  type CoopZombieSnap,
} from '../net/coopProtocol';
import './gunPad.css';

/** Phone-only gunner seat. The TV runs the diorama; this page only aims and shoots. */
export class GunPad {
  private root: HTMLElement;
  private client: CoopClient;
  private code: string;
  private statusEl!: HTMLElement;
  private statusWrap!: HTMLElement;
  private radar!: HTMLCanvasElement;
  private aimPad!: HTMLElement;
  private stick!: HTMLElement;
  private hint!: HTMLElement;
  private fireBtn!: HTMLButtonElement;
  private autoBtn!: HTMLButtonElement;
  private weapon = 0 as 0 | 1 | 2;
  private autoFire = true;
  private autoAim = true;
  private fireHeld = false;
  private aiming = false;
  private aimAngle = Math.PI;
  private host: CoopHostSnap | null = null;
  private lastSend = 0;
  private live = false;

  constructor(root: HTMLElement) {
    this.root = root;
    const code = parseCoopQuery();
    if (!code) {
      root.innerHTML = `<div class="gun-shell"><div class="gun-banner"><h1>Missing ride link</h1><p class="sub">Ask the driver to tap SHARE RIDE on the TV and send you the new link.</p></div></div>`;
      this.code = '';
      this.client = new CoopClient({
        onWelcome: () => undefined,
        onPeer: () => undefined,
        onHost: () => undefined,
        onGun: () => undefined,
        onDrop: () => undefined,
        onToast: () => undefined,
        onStatus: () => undefined,
      });
      return;
    }
    this.code = code;
    this.client = new CoopClient({
      onWelcome: (role) => {
        this.live = true;
        this.setStatus(role === 'gunner' ? `GUNNER · ${this.code}` : `SEATED · ${this.code}`, true);
      },
      onPeer: (_role, online) => {
        this.setStatus(online ? `TV LIVE · ${this.code}` : `WAITING FOR TV · ${this.code}`, online);
      },
      onHost: (snap) => {
        this.host = snap;
        this.live = true;
        this.setStatus(`TV LIVE · ${this.code}`, true);
        if (!this.aiming && this.autoAim) this.aimNearest(snap);
      },
      onGun: () => undefined,
      onDrop: () => undefined,
      onToast: () => undefined,
      onStatus: (text) => this.setStatus(text, text.includes('LIVE')),
    });
    this.render();
    this.bind();
    this.client.connect(this.code, 'gunner');
    this.loop();
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="gun-shell">
        <header class="gun-banner">
          <h1>You're the gunner</h1>
          <p>Watch the TV. Aim here. Auto fire is on.</p>
          <p class="sub">Drag the pad to point. The bike on the TV does the shooting.</p>
          <div class="gun-status" id="gun-status-wrap"><span class="dot"></span><span id="gun-status">CONNECTING…</span></div>
        </header>
        <div class="gun-stage">
          <div class="gun-radar-wrap">
            <div class="gun-radar-label">BIKE RADAR</div>
            <canvas id="gun-radar" width="360" height="360"></canvas>
          </div>
          <div class="gun-aim" id="gun-aim">
            <div class="gun-aim-hint">DRAG TO AIM<br/>RELEASE KEEPS THAT ANGLE</div>
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
            <button type="button" class="gun-btn weapon" data-w="2">3 FIREBOMB</button>
          </div>
          <button type="button" class="gun-btn fire" id="btn-fire">HOLD TO FIRE</button>
        </div>
        <footer class="gun-footer">Phone = controller · TV = the ride · code ${this.code}</footer>
      </div>
    `;
    this.statusEl = this.root.querySelector('#gun-status') as HTMLElement;
    this.statusWrap = this.root.querySelector('#gun-status-wrap') as HTMLElement;
    this.radar = this.root.querySelector('#gun-radar') as HTMLCanvasElement;
    this.aimPad = this.root.querySelector('#gun-aim') as HTMLElement;
    this.stick = this.root.querySelector('#gun-stick') as HTMLElement;
    this.hint = this.root.querySelector('.gun-aim-hint') as HTMLElement;
    this.fireBtn = this.root.querySelector('#btn-fire') as HTMLButtonElement;
    this.autoBtn = this.root.querySelector('#btn-auto') as HTMLButtonElement;
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
      // Screen up aims forward relative to bike heading once host exists.
      const stickAngle = Math.atan2(dx, -dy);
      const heading = this.host?.bike.heading ?? 0;
      this.aimAngle = heading + stickAngle;
      this.aiming = true;
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
      this.fireBtn.textContent = this.autoFire ? 'HOLD TO FIRE' : 'HOLD TO FIRE';
    });
    this.root.querySelector('#btn-autoaim')?.addEventListener('click', (e) => {
      this.autoAim = !this.autoAim;
      const btn = e.currentTarget as HTMLButtonElement;
      btn.textContent = this.autoAim ? 'AUTO AIM: ON' : 'AUTO AIM: OFF';
      btn.classList.toggle('active', this.autoAim);
    });
    this.root.querySelectorAll('.weapon').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.weapon = parseInt((btn as HTMLElement).dataset.w || '0', 10) as 0 | 1 | 2;
        this.root.querySelectorAll('.weapon').forEach((el) => el.classList.toggle('active', el === btn));
      });
    });
    const setFire = (on: boolean) => {
      this.fireHeld = on;
      this.fireBtn.classList.toggle('held', on);
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
    let bestD = 14;
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

  private loop = (): void => {
    const now = performance.now() / 1000;
    this.drawRadar();
    if (this.client.connected && now - this.lastSend > 0.05) {
      this.lastSend = now;
      const bike = this.host?.bike;
      this.client.send({
        t: 'gun',
        aim: this.aimAngle,
        weapon: this.weapon,
        autoAim: this.autoAim && !this.aiming,
        autoFire: this.autoFire,
        fireHeld: this.fireHeld,
        mx: bike ? bike.x + Math.sin(this.aimAngle) * 8 : 0,
        mz: bike ? bike.z + Math.cos(this.aimAngle) * 8 : 0,
      });
    }
    requestAnimationFrame(this.loop);
  };

  private drawRadar(): void {
    const ctx = this.radar.getContext('2d');
    if (!ctx) return;
    const w = this.radar.width;
    const h = this.radar.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#071019';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    ctx.strokeStyle = 'rgba(148,163,184,0.2)';
    ctx.lineWidth = 1;
    for (const r of [40, 80, 120, 160]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const snap = this.host;
    if (!snap) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.live ? 'Waiting for TV…' : 'Connecting…', cx, cy);
      return;
    }
    const scale = 9;
    const heading = snap.bike.heading;
    const rot = (x: number, z: number) => {
      const dx = x - snap.bike.x;
      const dz = z - snap.bike.z;
      const c = Math.cos(-heading);
      const s = Math.sin(-heading);
      return { x: cx + (dx * c - dz * s) * scale, y: cy + (dx * s + dz * c) * scale };
    };
    for (const z of snap.zombies) {
      const p = rot(z.x, z.z);
      ctx.fillStyle = z.kind === 'mutant' ? '#d946ef' : '#ef4444';
      ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    }
    // Aim wedge
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.aimAngle - heading);
    ctx.fillStyle = 'rgba(251, 191, 36, 0.18)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 150, -0.28, 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fbbf24';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -120);
    ctx.stroke();
    ctx.restore();
    // Bike
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx + 8, cy + 8);
    ctx.lineTo(cx - 8, cy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`HP ${Math.round(snap.bike.hp)}`, 14, h - 18);
    ctx.fillText(`KILLS ${snap.kills}`, 110, h - 18);
  }
}
