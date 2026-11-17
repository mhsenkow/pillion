import { WEAPONS } from '../core/constants';
import type { BikeState, WeaponDef, WeaponIndex } from '../core/types';

export type BikeUpgradeKey = 'armor' | 'tank' | 'engine';
export type GunnerUpgradeKey = 'turret' | 'fireRate' | 'spread' | 'explosive';

export type UpgradeLevels = {
  bike: Record<BikeUpgradeKey, number>;
  gunner: Record<GunnerUpgradeKey, number>;
};

export const UPGRADE_MAX_LEVEL = 5;

const BIKE_COST = [15, 28, 45, 70, 100] as const;
const GUNNER_COST = [18, 32, 50, 75, 110] as const;

export function defaultUpgradeLevels(): UpgradeLevels {
  return {
    bike: { armor: 0, tank: 0, engine: 0 },
    gunner: { turret: 0, fireRate: 0, spread: 0, explosive: 0 },
  };
}

export function bikeUpgradeCost(key: BikeUpgradeKey, levels: UpgradeLevels): number | null {
  const lv = levels.bike[key];
  if (lv >= UPGRADE_MAX_LEVEL) return null;
  return BIKE_COST[lv];
}

export function gunnerUpgradeCost(key: GunnerUpgradeKey, levels: UpgradeLevels): number | null {
  const lv = levels.gunner[key];
  if (lv >= UPGRADE_MAX_LEVEL) return null;
  return GUNNER_COST[lv];
}

export function buyBikeUpgrade(key: BikeUpgradeKey, scrap: number, levels: UpgradeLevels): { scrap: number; levels: UpgradeLevels; ok: boolean } {
  const cost = bikeUpgradeCost(key, levels);
  if (cost == null || scrap < cost) return { scrap, levels, ok: false };
  return {
    scrap: scrap - cost,
    levels: {
      ...levels,
      bike: { ...levels.bike, [key]: levels.bike[key] + 1 },
    },
    ok: true,
  };
}

export function buyGunnerUpgrade(
  key: GunnerUpgradeKey,
  scrap: number,
  levels: UpgradeLevels,
): { scrap: number; levels: UpgradeLevels; ok: boolean } {
  const cost = gunnerUpgradeCost(key, levels);
  if (cost == null || scrap < cost) return { scrap, levels, ok: false };
  return {
    scrap: scrap - cost,
    levels: {
      ...levels,
      gunner: { ...levels.gunner, [key]: levels.gunner[key] + 1 },
    },
    ok: true,
  };
}

/** Apply passive bike bonuses from upgrade tiers (does not mutate hp/fuel caps beyond refill headroom). */
export function applyBikeUpgrades(bike: BikeState, levels: UpgradeLevels): BikeState {
  const armor = levels.bike.armor;
  const tank = levels.bike.tank;
  const engine = levels.bike.engine;
  const hpBonus = armor * 8;
  const fuelBonus = tank * 10;
  const speedMul = 1 + engine * 0.04;
  return {
    ...bike,
    hp: Math.min(100 + hpBonus, bike.hp + hpBonus * 0.15),
    fuel: Math.min(100 + fuelBonus, bike.fuel + fuelBonus * 0.1),
    speed: bike.speed * speedMul,
    vx: bike.vx * speedMul,
    vz: bike.vz * speedMul,
  };
}

export function weaponStatsFromUpgrades(weaponIndex: WeaponIndex, levels: UpgradeLevels): WeaponDef {
  const base = WEAPONS[weaponIndex];
  const turret = levels.gunner.turret;
  const rate = levels.gunner.fireRate;
  const spreadLv = levels.gunner.spread;
  const boom = levels.gunner.explosive;
  const cooldown = base.cooldown * Math.max(0.55, 1 - rate * 0.07 - turret * 0.03);
  const spread = Math.max(0.02, base.spread * (1 - spreadLv * 0.08));
  const damage = base.damage * (1 + turret * 0.06 + boom * 0.08);
  const breach = base.breach + (boom >= 3 && base.explosive ? 1 : 0);
  return {
    ...base,
    cooldown,
    spread,
    damage,
    breach,
    explosive: base.explosive || boom >= 2,
  };
}