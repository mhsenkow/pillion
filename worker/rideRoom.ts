import { DurableObject } from 'cloudflare:workers';
import type { CoopRole } from '../src/net/coopProtocol';

interface Attachment {
  role: CoopRole;
  seat?: string;
  name?: string;
  color?: string;
  lastHb: number;
}

interface PersistedRide {
  lat?: number;
  lon?: number;
  scrap?: number;
  kills?: number;
  tripKm?: number;
  destName?: string;
  damage?: Record<string, number[]>;
  gunnerSeat?: string;
  updatedAt?: number;
}

const MAX_MSG = 48_000;
const AWAY_MS = 3000;

/** One shared ride. First seat is the driver; the share link fills the gunner seat. */
export class RideRoom extends DurableObject {
  private rate = new Map<WebSocket, { n: number; t: number }>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/state') && request.method === 'GET') {
      const state = ((await this.ctx.storage.get('ride')) as PersistedRide) || {};
      return Response.json(state);
    }
    if (url.pathname.endsWith('/state') && request.method === 'POST') {
      const body = (await request.json()) as PersistedRide;
      const prev = ((await this.ctx.storage.get('ride')) as PersistedRide) || {};
      const next = { ...prev, ...body, updatedAt: Date.now() };
      await this.ctx.storage.put('ride', next);
      return Response.json({ ok: true });
    }

    if (url.pathname.endsWith('/ws') || url.searchParams.has('ws')) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const wanted = (url.searchParams.get('role') || 'auto') as CoopRole | 'auto';
      const seat = url.searchParams.get('seat') || '';
      const name = (url.searchParams.get('name') || '').slice(0, 16);
      const color = (url.searchParams.get('color') || '#38bdf8').slice(0, 16);
      const role = this.assignRole(wanted, seat);
      if (!role) {
        return new Response(JSON.stringify({ error: 'ride_full', text: 'Ask for a new link' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        role,
        seat,
        name,
        color,
        lastHb: Date.now(),
      } satisfies Attachment);
      if (role === 'gunner' && seat) {
        const prev = ((await this.ctx.storage.get('ride')) as PersistedRide) || {};
        await this.ctx.storage.put('ride', { ...prev, gunnerSeat: seat, updatedAt: Date.now() });
      }
      const persisted = ((await this.ctx.storage.get('ride')) as PersistedRide) || {};
      server.send(
        JSON.stringify({
          t: 'welcome',
          role,
          code: url.searchParams.get('code') || '',
          peers: this.ctx.getWebSockets().length,
        }),
      );
      if (persisted.lat != null) {
        server.send(
          JSON.stringify({
            t: 'state',
            lat: persisted.lat,
            lon: persisted.lon,
            scrap: persisted.scrap ?? 0,
            kills: persisted.kills ?? 0,
            tripKm: persisted.tripKm,
            destName: persisted.destName,
          }),
        );
      }
      this.broadcast(
        JSON.stringify({
          t: 'peer',
          role,
          online: true,
          peers: this.ctx.getWebSockets().length,
          name,
          color,
        }),
        server,
      );
      if (role === 'gunner') {
        this.broadcast(
          JSON.stringify({
            t: 'evt',
            kind: 'join',
            text: `${(name || 'GUNNER').toUpperCase()} JOINED · GUNNER`,
            at: Date.now() / 1000,
          }),
          server,
        );
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('ride room', { status: 200 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;

    if (typeof message === 'string') {
      if (message.length > MAX_MSG) return;
      if (!this.allow(ws)) return;
      try {
        const parsed = JSON.parse(message) as { t?: string; at?: number; echo?: number };
        if (!parsed || typeof parsed.t !== 'string') return;
        if (parsed.t === 'hb') {
          att.lastHb = Date.now();
          ws.serializeAttachment(att);
          ws.send(JSON.stringify({ t: 'hb', at: Date.now() / 1000, echo: parsed.at }));
          return;
        }
        if (parsed.t === 'state') {
          const prev = ((await this.ctx.storage.get('ride')) as PersistedRide) || {};
          await this.ctx.storage.put('ride', {
            ...prev,
            ...(parsed as PersistedRide),
            updatedAt: Date.now(),
          });
        }
      } catch {
        return;
      }
    } else if (message.byteLength > 64_000) {
      return;
    } else if (!this.allow(ws)) {
      return;
    }

    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue;
      const other = peer.deserializeAttachment() as Attachment | null;
      if (!other) continue;
      if (att.role === 'driver' && other.role === 'gunner') peer.send(message);
      if (att.role === 'gunner' && other.role === 'driver') peer.send(message);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    this.broadcast(
      JSON.stringify({
        t: 'peer',
        role: att?.role || 'gunner',
        online: false,
        peers: Math.max(0, this.ctx.getWebSockets().length - 1),
        name: att?.name,
        color: att?.color,
      }),
      ws,
    );
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'error');
    } catch {
      /* ignore */
    }
  }

  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const cur = this.rate.get(ws) || { n: 0, t: now };
    if (now - cur.t > 1000) {
      cur.n = 0;
      cur.t = now;
    }
    cur.n++;
    this.rate.set(ws, cur);
    return cur.n < 90;
  }

  private assignRole(wanted: CoopRole | 'auto', seat: string): CoopRole | null {
    const taken = new Set<CoopRole>();
    let gunnerWs: WebSocket | null = null;
    for (const peer of this.ctx.getWebSockets()) {
      const att = peer.deserializeAttachment() as Attachment | null;
      if (!att?.role) continue;
      if (Date.now() - (att.lastHb || 0) > AWAY_MS * 4) {
        // Stale socket — still counts as taken until closed.
      }
      taken.add(att.role);
      if (att.role === 'gunner') gunnerWs = peer;
    }
    if (wanted === 'gunner' && seat && gunnerWs) {
      const g = gunnerWs.deserializeAttachment() as Attachment | null;
      if (g?.seat && g.seat === seat) {
        try {
          gunnerWs.close(4000, 'reseat');
        } catch {
          /* ignore */
        }
        return 'gunner';
      }
    }
    if (wanted === 'driver' || wanted === 'gunner') {
      if (taken.has(wanted)) return null;
      return wanted;
    }
    if (!taken.has('driver')) return 'driver';
    if (!taken.has('gunner')) return 'gunner';
    return null;
  }

  private broadcast(message: string | ArrayBuffer, except?: WebSocket): void {
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === except) continue;
      try {
        peer.send(message);
      } catch {
        /* drop */
      }
    }
  }
}
