import { HALF_L, HALF_W, WORLD_L, WORLD_W } from '../core/constants';

export type TrailKind = 'tire' | 'dust';

export interface TrailMark {
  wx: number;
  wz: number;
  heading: number;
  strength: number;
  kind: TrailKind;
  born: number;
}

export interface GroundSheetDrawOpts {
  /** Canvas width in pixels (defaults to map underlay 512). */
  width?: number;
  /** Canvas height in pixels (defaults to map underlay 1024). */
  height?: number;
  /** World epoch seconds — drives fade; defaults to `performance.now() / 1000`. */
  now?: number;
}

const DEFAULT_CAP = 640;
const TIRE_TTL = 14;
const DUST_TTL = 2.4;

/** Ring buffer of tire smears and drift dust for the live-map ground sheet. */
export class TrailRingBuffer {
  private readonly cap: number;
  private buf: TrailMark[];
  private head = 0;
  private size = 0;

  constructor(capacity = DEFAULT_CAP) {
    this.cap = Math.max(32, capacity | 0);
    this.buf = new Array(this.cap);
  }

  get length(): number {
    return this.size;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }

  /** Stamp a dark rubber smear along bike heading. */
  pushTire(wx: number, wz: number, heading: number, strength = 1): void {
    this.push(wx, wz, heading, Math.min(1.4, Math.max(0.15, strength)), 'tire');
  }

  /** Puff drifting dust at the rear wheels. */
  pushDust(wx: number, wz: number, heading: number, strength = 1): void {
    this.push(wx, wz, heading, Math.min(1.2, Math.max(0.1, strength)), 'dust');
  }

  private push(wx: number, wz: number, heading: number, strength: number, kind: TrailKind): void {
    const born = performance.now() / 1000;
    const slot = this.size < this.cap ? this.size : this.head;
    if (this.size < this.cap) this.size += 1;
    this.buf[slot] = { wx, wz, heading, strength, kind, born };
    this.head = (slot + 1) % this.cap;
  }

  /** Map world XZ into 0..1 UV on the chunk ground sheet. */
  worldToUv(wx: number, wz: number): { u: number; v: number } {
    const u = (wx + HALF_W) / WORLD_W;
    const v = 1 - (wz + HALF_L) / WORLD_L;
    return { u, v };
  }

  uvToCanvas(u: number, v: number, w: number, h: number): { x: number; y: number } {
    return { x: u * w, y: v * h };
  }

  /** Composite fading trails onto a 2D ground sheet (e.g. map underlay canvas). */
  drawGroundSheet(ctx: CanvasRenderingContext2D, opts: GroundSheetDrawOpts = {}): void {
    const w = opts.width ?? ctx.canvas.width;
    const h = opts.height ?? ctx.canvas.height;
    const now = opts.now ?? performance.now() / 1000;
    if (this.size === 0) return;

    ctx.save();
    for (let i = 0; i < this.size; i++) {
      const mark = this.buf[i];
      if (!mark) continue;
      const ttl = mark.kind === 'tire' ? TIRE_TTL : DUST_TTL;
      const age = now - mark.born;
      if (age > ttl) continue;
      const fade = 1 - age / ttl;
      const { u, v } = this.worldToUv(mark.wx, mark.wz);
      if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) continue;
      const { x, y } = this.uvToCanvas(u, v, w, h);

      if (mark.kind === 'tire') {
        const len = (mark.kind === 'tire' ? 14 : 6) * mark.strength * (w / 512);
        const wid = 3.2 * mark.strength * (w / 512);
        ctx.translate(x, y);
        ctx.rotate(-mark.heading);
        ctx.globalAlpha = 0.22 * fade * mark.strength;
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(-len * 0.55, -wid * 0.5, len, wid);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        const r = (5 + mark.strength * 7) * (w / 512);
        ctx.globalAlpha = 0.28 * fade * mark.strength;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(212, 180, 130, 0.55)');
        g.addColorStop(0.55, 'rgba(120, 90, 60, 0.25)');
        g.addColorStop(1, 'rgba(40, 32, 24, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Drop expired slots (optional periodic compaction). */
  prune(now = performance.now() / 1000): void {
    let kept = 0;
    const next: TrailMark[] = [];
    for (let i = 0; i < this.size; i++) {
      const m = this.buf[i];
      if (!m) continue;
      const ttl = m.kind === 'tire' ? TIRE_TTL : DUST_TTL;
      if (now - m.born <= ttl) {
        next.push(m);
        kept += 1;
      }
    }
    this.buf = next.concat(new Array(Math.max(0, this.cap - kept)));
    this.size = kept;
    this.head = kept % this.cap;
  }
}

export const groundTrails = new TrailRingBuffer();