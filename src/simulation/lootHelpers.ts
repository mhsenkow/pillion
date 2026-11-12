import * as THREE from 'three';
import type { LootKind } from '../core/types';

export const LOOT_CRATE_GEO = new THREE.BoxGeometry(0.62, 0.52, 0.62);

export function lootColor(kind: LootKind): number {
  switch (kind) {
    case 'fuel':
      return 0xf59e0b;
    case 'scrap':
      return 0x94a3b8;
    case 'med':
      return 0x34d399;
    default:
      return 0xfbbf24;
  }
}

export function createLootMesh(kind: LootKind): THREE.Mesh {
  const color = lootColor(kind);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.4,
    metalness: 0.35,
    emissive: color,
    emissiveIntensity: 0.15,
  });
  const m = new THREE.Mesh(LOOT_CRATE_GEO, mat);
  m.castShadow = false;
  return m;
}
