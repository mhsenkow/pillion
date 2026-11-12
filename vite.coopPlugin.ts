import type { Plugin } from 'vite';
import type { IncomingMessage } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { newRoomCode, type CoopRole } from './src/net/coopProtocol';

interface Seat {
  role: CoopRole;
  socket: WebSocket;
}

interface LocalRoom {
  seats: Seat[];
}

/** In-memory co-op rooms so two local browser tabs can share a ride during `npm run dev`. */
export function coopDevProxy(): Plugin {
  const rooms = new Map<string, LocalRoom>();

  return {
    name: 'pillion-coop-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/coop/new')) return next();
        const code = newRoomCode();
        rooms.set(code, { seats: [] });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ code, join: `/?coop=${code}` }));
      });

      const wss = new WebSocketServer({ noServer: true });
      server.httpServer?.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (url.pathname !== '/api/coop/ws') return;
        const code = (url.searchParams.get('code') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (code.length < 3) {
          socket.destroy();
          return;
        }
        if (!rooms.has(code)) rooms.set(code, { seats: [] });
        wss.handleUpgrade(req as IncomingMessage, socket, head, (ws) => {
          const room = rooms.get(code)!;
          const wanted = (url.searchParams.get('role') || 'auto') as CoopRole | 'auto';
          const role = assignRole(room, wanted);
          if (!role) {
            ws.close(4000, 'ride_full');
            return;
          }
          const seat: Seat = { role, socket: ws };
          room.seats.push(seat);
          ws.send(JSON.stringify({ t: 'welcome', role, code, peers: room.seats.length }));
          broadcast(room, { t: 'peer', role, online: true, peers: room.seats.length }, ws);
          ws.on('message', (data) => {
            const text = typeof data === 'string' ? data : data.toString();
            for (const peer of room.seats) {
              if (peer.socket === ws) continue;
              if (seat.role === 'driver' && peer.role === 'gunner') peer.socket.send(text);
              if (seat.role === 'gunner' && peer.role === 'driver') peer.socket.send(text);
            }
          });
          ws.on('close', () => {
            room.seats = room.seats.filter((s) => s.socket !== ws);
            broadcast(room, { t: 'peer', role, online: false, peers: room.seats.length });
            if (!room.seats.length) rooms.delete(code);
          });
        });
      });
    },
  };
}

function assignRole(room: LocalRoom, wanted: CoopRole | 'auto'): CoopRole | null {
  const taken = new Set(room.seats.map((s) => s.role));
  if (wanted === 'driver' || wanted === 'gunner') {
    if (taken.has(wanted)) return null;
    return wanted;
  }
  if (!taken.has('driver')) return 'driver';
  if (!taken.has('gunner')) return 'gunner';
  return null;
}

function broadcast(room: LocalRoom, payload: object, except?: WebSocket): void {
  const text = JSON.stringify(payload);
  for (const seat of room.seats) {
    if (seat.socket === except) continue;
    if (seat.socket.readyState === seat.socket.OPEN) seat.socket.send(text);
  }
}
