/** Shared co-op wire format for the Durable Object room and the Vite local room. */

export type CoopRole = 'driver' | 'gunner';

export interface CoopZombieSnap {
  x: number;
  z: number;
  kind: string;
}

export interface CoopHostSnap {
  t: 'host';
  at: number;
  bike: {
    x: number;
    z: number;
    vx: number;
    vz: number;
    heading: number;
    speed: number;
    lean: number;
    drifting: boolean;
    hp: number;
    fuel: number;
  };
  aim: number;
  weapon: 0 | 1 | 2;
  fire: boolean;
  lat: number;
  lon: number;
  cx: number;
  cz: number;
  scrap: number;
  kills: number;
  horde: number;
  place: string;
  objective: string;
  zombies: CoopZombieSnap[];
}

export interface CoopGunInput {
  t: 'gun';
  aim: number;
  weapon: 0 | 1 | 2;
  autoAim: boolean;
  autoFire: boolean;
  fireHeld: boolean;
  mx: number;
  mz: number;
}

export interface CoopWelcome {
  t: 'welcome';
  role: CoopRole;
  code: string;
  peers: number;
}

export interface CoopPeer {
  t: 'peer';
  role: CoopRole;
  online: boolean;
  peers: number;
}

export interface CoopDrop {
  t: 'drop';
  lat: number;
  lon: number;
  name: string;
  biome: string;
}

export interface CoopChat {
  t: 'toast';
  text: string;
}

export type CoopMessage = CoopHostSnap | CoopGunInput | CoopWelcome | CoopPeer | CoopDrop | CoopChat;

export function parseCoopMessage(raw: string): CoopMessage | null {
  try {
    const data = JSON.parse(raw) as CoopMessage;
    if (!data || typeof data !== 'object' || !('t' in data)) return null;
    return data;
  } catch {
    return null;
  }
}

export function newRoomCode(): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  let out = '';
  for (let i = 0; i < 5; i++) out += alphabet[(Math.random() * alphabet.length) | 0];
  return out;
}

export function parseCoopQuery(search = typeof location !== 'undefined' ? location.search : ''): string | null {
  const code = new URLSearchParams(search).get('coop');
  if (!code) return null;
  const cleaned = code.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned.length >= 3 ? cleaned : null;
}

export function writeCoopQuery(code: string | null, asTv = false): void {
  if (typeof history === 'undefined') return;
  const url = new URL(location.href);
  if (code) {
    url.searchParams.set('coop', code);
    if (asTv) url.searchParams.set('tv', '1');
  } else {
    url.searchParams.delete('coop');
    url.searchParams.delete('tv');
  }
  history.replaceState({}, '', url.toString());
}

export function coopShareUrl(code: string): string {
  const base = typeof location !== 'undefined' ? location.origin : 'https://pillion.ibm.io';
  return `${base}/gun?coop=${encodeURIComponent(code)}`;
}
