/** Shared co-op wire format for the Durable Object room and the Vite local room. */

export type CoopRole = 'driver' | 'gunner';

export interface CoopZombieSnap {
  x: number;
  z: number;
  kind: string;
}

export interface CoopProjectileSnap {
  x: number;
  z: number;
  kind: number;
}

export interface CoopFlashSnap {
  x: number;
  z: number;
  life: number;
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
  projectiles?: CoopProjectileSnap[];
  flashes?: CoopFlashSnap[];
  rttMs?: number;
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
  special?: boolean;
  name?: string;
  color?: string;
  seat?: string;
}

export interface CoopWelcome {
  t: 'welcome';
  role: CoopRole;
  code: string;
  peers: number;
  error?: string;
}

export interface CoopPeer {
  t: 'peer';
  role: CoopRole;
  online: boolean;
  peers: number;
  away?: boolean;
  name?: string;
  color?: string;
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

export interface CoopHeartbeat {
  t: 'hb';
  at: number;
  echo?: number;
}

export interface CoopEvent {
  t: 'evt';
  kind: 'kill' | 'blast' | 'building' | 'loot' | 'bark' | 'join';
  text: string;
  at: number;
}

export interface CoopRoomState {
  t: 'state';
  lat: number;
  lon: number;
  scrap: number;
  kills: number;
  tripKm?: number;
  destName?: string;
}

export interface CoopError {
  t: 'error';
  code: 'ride_full' | 'stale' | 'bad_message';
  text: string;
}

export type CoopMessage =
  | CoopHostSnap
  | CoopGunInput
  | CoopWelcome
  | CoopPeer
  | CoopDrop
  | CoopChat
  | CoopHeartbeat
  | CoopEvent
  | CoopRoomState
  | CoopError;

const KIND_CODES: Record<string, number> = { walker: 0, runner: 1, mutant: 2, tank: 3 };
const KIND_NAMES = ['walker', 'runner', 'mutant', 'tank'];

/** Compact binary host snapshot: Float32 payload after a 1-byte tag. */
export function encodeHostBinary(snap: CoopHostSnap): ArrayBuffer {
  const zCount = Math.min(48, snap.zombies.length);
  const pCount = Math.min(24, snap.projectiles?.length ?? 0);
  const fCount = Math.min(12, snap.flashes?.length ?? 0);
  const place = snap.place.slice(0, 48);
  const objective = snap.objective.slice(0, 64);
  const placeBytes = new TextEncoder().encode(place);
  const objBytes = new TextEncoder().encode(objective);
  // header floats: at, bike(10), aim, weapon, fire, lat, lon, cx, cz, scrap, kills, horde, z,p,f counts
  const floatCount = 1 + 10 + 1 + 1 + 1 + 2 + 2 + 3 + 3 + zCount * 3 + pCount * 3 + fCount * 3;
  const buf = new ArrayBuffer(4 + floatCount * 4 + 2 + placeBytes.length + 2 + objBytes.length);
  const view = new DataView(buf);
  view.setUint8(0, 0x48); // 'H'
  view.setUint8(1, 1); // version
  let o = 4;
  const f = (v: number) => {
    view.setFloat32(o, v, true);
    o += 4;
  };
  f(snap.at);
  f(snap.bike.x);
  f(snap.bike.z);
  f(snap.bike.vx);
  f(snap.bike.vz);
  f(snap.bike.heading);
  f(snap.bike.speed);
  f(snap.bike.lean);
  f(snap.bike.drifting ? 1 : 0);
  f(snap.bike.hp);
  f(snap.bike.fuel);
  f(snap.aim);
  f(snap.weapon);
  f(snap.fire ? 1 : 0);
  f(snap.lat);
  f(snap.lon);
  f(snap.cx);
  f(snap.cz);
  f(snap.scrap);
  f(snap.kills);
  f(snap.horde);
  f(zCount);
  f(pCount);
  f(fCount);
  for (let i = 0; i < zCount; i++) {
    const z = snap.zombies[i];
    f(z.x);
    f(z.z);
    f(KIND_CODES[z.kind] ?? 0);
  }
  for (let i = 0; i < pCount; i++) {
    const p = snap.projectiles![i];
    f(p.x);
    f(p.z);
    f(p.kind);
  }
  for (let i = 0; i < fCount; i++) {
    const fl = snap.flashes![i];
    f(fl.x);
    f(fl.z);
    f(fl.life);
  }
  view.setUint16(o, placeBytes.length, true);
  o += 2;
  new Uint8Array(buf, o, placeBytes.length).set(placeBytes);
  o += placeBytes.length;
  view.setUint16(o, objBytes.length, true);
  o += 2;
  new Uint8Array(buf, o, objBytes.length).set(objBytes);
  return buf;
}

export function decodeHostBinary(buf: ArrayBuffer): CoopHostSnap | null {
  if (buf.byteLength < 8) return null;
  const view = new DataView(buf);
  if (view.getUint8(0) !== 0x48) return null;
  let o = 4;
  const f = () => {
    const v = view.getFloat32(o, true);
    o += 4;
    return v;
  };
  try {
    const at = f();
    const bike = {
      x: f(),
      z: f(),
      vx: f(),
      vz: f(),
      heading: f(),
      speed: f(),
      lean: f(),
      drifting: f() > 0.5,
      hp: f(),
      fuel: f(),
    };
    const aim = f();
    const weapon = Math.max(0, Math.min(2, Math.round(f()))) as 0 | 1 | 2;
    const fire = f() > 0.5;
    const lat = f();
    const lon = f();
    const cx = f();
    const cz = f();
    const scrap = f();
    const kills = f();
    const horde = f();
    const zCount = Math.max(0, Math.min(48, Math.round(f())));
    const pCount = Math.max(0, Math.min(24, Math.round(f())));
    const fCount = Math.max(0, Math.min(12, Math.round(f())));
    const zombies: CoopZombieSnap[] = [];
    for (let i = 0; i < zCount; i++) {
      zombies.push({ x: f(), z: f(), kind: KIND_NAMES[Math.round(f())] || 'walker' });
    }
    const projectiles: CoopProjectileSnap[] = [];
    for (let i = 0; i < pCount; i++) {
      projectiles.push({ x: f(), z: f(), kind: Math.round(f()) });
    }
    const flashes: CoopFlashSnap[] = [];
    for (let i = 0; i < fCount; i++) {
      flashes.push({ x: f(), z: f(), life: f() });
    }
    const placeLen = view.getUint16(o, true);
    o += 2;
    const place = new TextDecoder().decode(new Uint8Array(buf, o, placeLen));
    o += placeLen;
    const objLen = view.getUint16(o, true);
    o += 2;
    const objective = new TextDecoder().decode(new Uint8Array(buf, o, objLen));
    return {
      t: 'host',
      at,
      bike,
      aim,
      weapon,
      fire,
      lat,
      lon,
      cx: Math.round(cx),
      cz: Math.round(cz),
      scrap,
      kills,
      horde,
      place,
      objective,
      zombies,
      projectiles,
      flashes,
    };
  } catch {
    return null;
  }
}

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
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < 4; i++) out += alphabet[(Math.random() * alphabet.length) | 0];
  return out;
}

export function parseCoopQuery(search = typeof location !== 'undefined' ? location.search : ''): string | null {
  const code = new URLSearchParams(search).get('coop');
  if (!code) return null;
  const cleaned = code.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned.length >= 3 ? cleaned : null;
}

export function isTvMode(search = typeof location !== 'undefined' ? location.search : ''): boolean {
  return new URLSearchParams(search).get('tv') === '1';
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

export function joinPageUrl(): string {
  const base = typeof location !== 'undefined' ? location.origin : 'https://pillion.ibm.io';
  return `${base}/join`;
}

export function gunnerSeatKey(code: string): string {
  return `pillion.gunner.seat.${code}`;
}

export function loadGunnerProfile(): { name: string; color: string; seat: string } {
  try {
    const raw = localStorage.getItem('pillion.gunner.profile');
    if (raw) return JSON.parse(raw) as { name: string; color: string; seat: string };
  } catch {
    /* ignore */
  }
  const seat = crypto.randomUUID?.() || `s${Date.now()}`;
  const colors = ['#38bdf8', '#f472b6', '#fbbf24', '#34d399', '#a78bfa'];
  const profile = {
    name: 'Gunner',
    color: colors[(Math.random() * colors.length) | 0],
    seat,
  };
  try {
    localStorage.setItem('pillion.gunner.profile', JSON.stringify(profile));
  } catch {
    /* ignore */
  }
  return profile;
}

export function saveGunnerProfile(name: string, color: string): void {
  const cur = loadGunnerProfile();
  const next = { ...cur, name: name.slice(0, 16) || 'Gunner', color };
  try {
    localStorage.setItem('pillion.gunner.profile', JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function validateIncoming(raw: string | ArrayBuffer): boolean {
  if (typeof raw !== 'string') return raw.byteLength > 0 && raw.byteLength < 64_000;
  return raw.length > 0 && raw.length < 48_000;
}
