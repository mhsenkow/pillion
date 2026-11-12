import { DurableObject } from 'cloudflare:workers';
import type { CoopRole } from '../src/net/coopProtocol';

interface Attachment {
  role: CoopRole;
}

/** One shared ride. First seat is the driver; the share link fills the gunner seat. */
export class RideRoom extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/ws') || url.searchParams.has('ws')) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const wanted = (url.searchParams.get('role') || 'auto') as CoopRole | 'auto';
      const role = this.assignRole(wanted);
      if (!role) {
        return new Response(JSON.stringify({ error: 'ride_full' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ role } satisfies Attachment);
      server.send(
        JSON.stringify({
          t: 'welcome',
          role,
          code: url.searchParams.get('code') || '',
          peers: this.ctx.getWebSockets().length,
        }),
      );
      this.broadcast(
        JSON.stringify({ t: 'peer', role, online: true, peers: this.ctx.getWebSockets().length }),
        server,
      );
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('ride room', { status: 200 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    // Driver state goes to gunner. Gunner aim/fire goes to driver.
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

  private assignRole(wanted: CoopRole | 'auto'): CoopRole | null {
    const taken = new Set<CoopRole>();
    for (const peer of this.ctx.getWebSockets()) {
      const att = peer.deserializeAttachment() as Attachment | null;
      if (att?.role) taken.add(att.role);
    }
    if (wanted === 'driver' || wanted === 'gunner') {
      if (taken.has(wanted)) return null;
      return wanted;
    }
    if (!taken.has('driver')) return 'driver';
    if (!taken.has('gunner')) return 'gunner';
    return null;
  }

  private broadcast(message: string, except?: WebSocket): void {
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
