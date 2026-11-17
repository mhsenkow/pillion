import type { ZombieEntity } from '../core/types';

/** Snap aim toward nearest zombie within a cone (~12°). */
export function assistAim(
  aim: number,
  originX: number,
  originZ: number,
  zombies: ZombieEntity[],
  coneRad = (12 * Math.PI) / 180,
): number {
  let best: ZombieEntity | null = null;
  let bestScore = Infinity;
  for (const z of zombies) {
    const ang = Math.atan2(z.x - originX, z.z - originZ);
    let d = ang - aim;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const dist = Math.hypot(z.x - originX, z.z - originZ);
    if (Math.abs(d) > coneRad || dist > 28) continue;
    const score = Math.abs(d) * 8 + dist;
    if (score < bestScore) {
      bestScore = score;
      best = z;
    }
  }
  if (!best) return aim;
  return Math.atan2(best.x - originX, best.z - originZ);
}
