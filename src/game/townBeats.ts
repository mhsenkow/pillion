import { mulberry32, hashCoords } from '../core/rng';
import type { OsmData, OsmPoi } from '../core/types';

export type TownBeatKind = 'survivor' | 'cache' | 'nest';

export interface TownBeat {
  kind: TownBeatKind;
  gx: number;
  gz: number;
  label: string;
  weight: number;
}

export type PassengerRescuePhase = 'none' | 'spotted' | 'escorting' | 'delivered';

export interface PassengerRescueState {
  phase: PassengerRescuePhase;
  gx: number;
  gz: number;
  timer: number;
  rewardScrap: number;
}

export type AchievementId =
  | 'first_cache'
  | 'block_clear'
  | 'boss_down'
  | 'passenger_saved'
  | 'coop_sync_kill'
  | 'structure_rain';

export interface AchievementStub {
  id: AchievementId;
  title: string;
  description: string;
}

export const ACHIEVEMENT_STUBS: AchievementStub[] = [
  { id: 'first_cache', title: 'Supply Run', description: 'Loot your first field cache.' },
  { id: 'block_clear', title: 'Grid Sweep', description: 'Clear a whole chunk block.' },
  { id: 'boss_down', title: 'City Breaker', description: 'Drop a downtown boss mutant.' },
  { id: 'passenger_saved', title: 'Getaway', description: 'Deliver an escorted survivor.' },
  { id: 'coop_sync_kill', title: 'Tandem Tap', description: 'Score a co-op double kill.' },
  { id: 'structure_rain', title: 'Demolition', description: 'Collapse six structures in one run.' },
];

export interface BossSpawnPlan {
  spawn: boolean;
  kind: 'mutant';
  label: string;
  hp: number;
  speed: number;
}

export function dailySeed(baseLat: number, baseLon: number, at = new Date()): number {
  const day = `${at.getUTCFullYear()}-${at.getUTCMonth() + 1}-${at.getUTCDate()}`;
  let h = 2166136261 >>> 0;
  const s = `${baseLat.toFixed(3)}_${baseLon.toFixed(3)}_${day}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function listFuelStations(osm: OsmData | null | undefined): OsmPoi[] {
  return (osm?.pois ?? []).filter((p) => p.kind === 'fuel');
}

export function hordeCountFromBuildings(buildingCount: number, biomeHint = 'URBAN'): number {
  const b = biomeHint.toUpperCase();
  const density =
    b === 'DENSE' ? 1.35 : b === 'URBAN' ? 1.15 : b === 'MEMPHIS' ? 1.05 : b === 'EMMETT' ? 0.92 : 0.82;
  const scaled = Math.floor(buildingCount * 0.42 * density);
  return Math.max(8, Math.min(72, scaled));
}

export function bossSpawnPlan(
  buildingCount: number,
  locationName: string,
  biomeHint = 'URBAN',
): BossSpawnPlan {
  const urban = biomeHint.toUpperCase() === 'DENSE' || biomeHint.toUpperCase() === 'URBAN';
  const namedCity = /downtown|city|metro|district/i.test(locationName);
  const spawn = buildingCount >= 18 && (urban || namedCity);
  return {
    spawn,
    kind: 'mutant',
    label: spawn ? 'DOWNTOWN ANCHOR' : '',
    hp: spawn ? 140 + Math.min(60, buildingCount) : 0,
    speed: spawn ? 3.8 : 0,
  };
}

export function generateTownBeats(
  osm: OsmData | null | undefined,
  baseLat: number,
  baseLon: number,
  chunkX: number,
  chunkZ: number,
): TownBeat[] {
  const rng = mulberry32(hashCoords(baseLat, baseLon, chunkX, chunkZ) ^ dailySeed(baseLat, baseLon));
  const beats: TownBeat[] = [];
  const buildings = osm?.buildings ?? [];
  const pois = osm?.pois ?? [];

  if (buildings.length) {
    const pick = buildings[Math.floor(rng() * buildings.length)];
    let cx = 0;
    let cz = 0;
    for (const [x, z] of pick.poly) {
      cx += x;
      cz += z;
    }
    cx /= pick.poly.length;
    cz /= pick.poly.length;
    beats.push({
      kind: 'nest',
      gx: Math.floor(cx),
      gz: Math.floor(cz),
      label: pick.name || 'Infested block',
      weight: 0.6 + rng() * 0.4,
    });
  }

  const shops = pois.filter((p) => p.kind === 'shop' || p.kind === 'fuel');
  if (shops.length) {
    const poi = shops[Math.floor(rng() * shops.length)];
    beats.push({
      kind: 'cache',
      gx: Math.floor(poi.gx),
      gz: Math.floor(poi.gz),
      label: poi.name || 'Hidden cache',
      weight: poi.kind === 'fuel' ? 1.1 : 0.85,
    });
  } else if (buildings.length > 2) {
    const b = buildings[Math.floor(rng() * buildings.length)];
    const [gx, gz] = b.poly[Math.floor(rng() * b.poly.length)];
    beats.push({ kind: 'cache', gx: Math.floor(gx), gz: Math.floor(gz), label: 'Stash rumor', weight: 0.7 });
  }

  const schools = pois.filter((p) => p.kind === 'school' || p.kind === 'hospital');
  const anchor = schools[0] ?? shops[0] ?? (buildings[0] ? { gx: buildings[0].poly[0][0], gz: buildings[0].poly[0][1] } : null);
  if (anchor) {
    const gx = 'gx' in anchor ? anchor.gx : anchor[0];
    const gz = 'gz' in anchor ? anchor.gz : anchor[1];
    beats.push({
      kind: 'survivor',
      gx: Math.floor(gx) + (rng() < 0.5 ? 2 : -2),
      gz: Math.floor(gz) + (rng() < 0.5 ? 2 : -2),
      label: 'Survivor ping',
      weight: 1.2,
    });
  }

  return beats;
}

export function createPassengerRescue(beat: TownBeat | undefined): PassengerRescueState {
  if (!beat || beat.kind !== 'survivor') {
    return { phase: 'none', gx: 0, gz: 0, timer: 0, rewardScrap: 0 };
  }
  return {
    phase: 'spotted',
    gx: beat.gx,
    gz: beat.gz,
    timer: 0,
    rewardScrap: Math.round(18 + beat.weight * 12),
  };
}

export function tickPassengerRescue(
  state: PassengerRescueState,
  bikeGx: number,
  bikeGz: number,
  dt: number,
  deliveryGx: number,
  deliveryGz: number,
): PassengerRescueState {
  if (state.phase === 'none') return state;
  const next = { ...state, timer: state.timer + dt };
  const near = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz) < 3.5;
  if (state.phase === 'spotted' && near(bikeGx, bikeGz, state.gx, state.gz)) {
    next.phase = 'escorting';
  }
  if (state.phase === 'escorting' && near(bikeGx, bikeGz, deliveryGx, deliveryGz)) {
    next.phase = 'delivered';
  }
  return next;
}

/** Simultaneous kill credit for tandem co-op — flat scrap bonus per synced takedown. */
export function coopDoubleKillBonus(killsThisTick: number, peersOnline: boolean): number {
  if (!peersOnline || killsThisTick < 2) return 0;
  return 3 + Math.min(12, (killsThisTick - 1) * 4);
}

export function checkAchievementStubs(flags: {
  cachesLooted: number;
  blockClear: boolean;
  bossKilled: boolean;
  passengerDelivered: boolean;
  coopDoubleKills: number;
  structuresCollapsed: number;
}): AchievementId[] {
  const out: AchievementId[] = [];
  if (flags.cachesLooted > 0) out.push('first_cache');
  if (flags.blockClear) out.push('block_clear');
  if (flags.bossKilled) out.push('boss_down');
  if (flags.passengerDelivered) out.push('passenger_saved');
  if (flags.coopDoubleKills > 0) out.push('coop_sync_kill');
  if (flags.structuresCollapsed >= 6) out.push('structure_rain');
  return out;
}