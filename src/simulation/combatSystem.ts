import * as THREE from 'three';
import { WEAPONS } from '../core/constants';
import type { GameState, Projectile, ZombieEntity } from '../core/types';
import { idx, worldToGrid } from '../geo/voxelizer';
import { TILE } from '../core/constants';

const projGeo = new THREE.BoxGeometry(0.18, 0.18, 0.36);

export function fireWeapon(
  state: GameState,
  now: number,
  entitiesGroup: THREE.Group,
  projectiles: Projectile[],
  fromDriver = false,
): boolean {
  const weapon = WEAPONS[state.partner.weaponIndex];
  if (now - state.partner.lastFireTime < weapon.cooldown) return false;
  state.partner.lastFireTime = now;
  if (fromDriver) state.partner.driverFiring = true;

  const originX = state.bike.x;
  const originZ = state.bike.z;
  let baseAngle = state.partner.aimAngle;
  if (fromDriver) {
    // Driver fires roughly to the right of heading (artwork pose)
    baseAngle = state.bike.heading - Math.PI / 2;
  }

  const overcharged = state.flareOverchargeUntil > now && state.partner.weaponIndex === 2;
  const dmgBoost =
    (state.unlockedTeslaBoost && state.partner.weaponIndex === 1 ? 1.35 : 1) *
    (overcharged ? 1.45 : 1);
  const speedBoost =
    state.unlockedTeslaBoost && state.partner.weaponIndex === 1 ? 1.15 : 1;

  for (let p = 0; p < weapon.pellets; p++) {
    const angle = baseAngle + (Math.random() - 0.5) * weapon.spread;
    const vx = Math.sin(angle) * weapon.speed * speedBoost;
    const vz = Math.cos(angle) * weapon.speed * speedBoost;
    const mat = new THREE.MeshBasicMaterial({ color: weapon.color });
    const mesh = new THREE.Mesh(projGeo, mat);
    mesh.position.set(originX, 0.85, originZ);
    mesh.rotation.y = angle;
    entitiesGroup.add(mesh);
    projectiles.push({
      mesh,
      x: originX,
      y: 0.85,
      z: originZ,
      vx,
      vz,
      life: 0.85,
      damage: weapon.damage * dmgBoost,
      color: weapon.color,
      explosive: weapon.explosive,
      breach: weapon.breach + (overcharged ? 1 : 0),
      ignites: weapon.ignites,
    });
  }
  return true;
}

export function updateAim(state: GameState, zombies: ZombieEntity[]): boolean {
  const b = state.bike;
  let targetAngle = Math.atan2(state.mouseWorldPos.x - b.x, state.mouseWorldPos.z - b.z);
  let hasThreat = false;

  if (state.partner.autoAim && !state.mouseDown && zombies.length > 0) {
    let bestDist = 13.5;
    let nearest: ZombieEntity | null = null;
    for (const z of zombies) {
      const d = Math.hypot(z.x - b.x, z.z - b.z);
      if (d < bestDist) {
        bestDist = d;
        nearest = z;
      }
    }
    if (nearest) {
      targetAngle = Math.atan2(nearest.x - b.x, nearest.z - b.z);
      hasThreat = true;
    }
  }
  state.partner.aimAngle = targetAngle;
  return hasThreat;
}

export function updateProjectiles(
  projectiles: Projectile[],
  zombies: ZombieEntity[],
  surfaceGrid: Uint8Array,
  entitiesGroup: THREE.Group,
  dt: number,
  onBurst: (x: number, y: number, z: number, color: number, count: number, speed: number) => void,
  onCity: (x: number, z: number, breach: number, ignites: boolean) => void,
): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.life -= dt;
    p.mesh.position.set(p.x, p.y, p.z);

    let hit = false;
    const { gx, gz } = worldToGrid(p.x, p.z);
    if (surfaceGrid[idx(gx, gz)] === TILE.BUILDING) hit = true;

    if (!hit) {
      for (const z of zombies) {
        if (Math.hypot(p.x - z.x, p.z - z.z) < 0.65) {
          z.hp -= p.damage;
          z.vx += p.vx * 0.25;
          z.vz += p.vz * 0.25;
          hit = true;
          break;
        }
      }
    }

    if (hit || p.life <= 0) {
      if (p.explosive) {
        const radius = p.damage > 110 ? 4.4 : 3.6;
        onBurst(p.x, 0.5, p.z, 0xf43f5e, 16, 10);
        onBurst(p.x, 0.7, p.z, 0xfbbf24, 8, 6);
        for (const z of zombies) {
          const d = Math.hypot(p.x - z.x, p.z - z.z);
          if (d < radius) {
            z.hp -= (p.damage * 0.9) * (1 - d / radius);
            z.vx += (z.x - p.x) * 9;
            z.vz += (z.z - p.z) * 9;
          }
        }
      } else if (hit) {
        onBurst(p.x, 0.5, p.z, p.color, 3, 3.5);
      }
      if (p.breach === 1 && surfaceGrid[idx(gx, gz)] === TILE.BUILDING) onCity(p.x, p.z, 1, false);
      else if (p.breach > 1) onCity(p.x, p.z, p.breach, p.ignites);
      entitiesGroup.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
      projectiles.splice(i, 1);
    }
  }
}
