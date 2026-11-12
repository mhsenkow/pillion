import * as THREE from 'three';
import type { GisPin, OsmData } from '../core/types';

export interface ChunkSnap {
  stamp: string;
  group: THREE.Group;
  surface: Uint8Array;
  height: Uint8Array;
  pins: GisPin[];
  banner: string;
  poiLabel: string;
  sourceTag: string;
  osm: OsmData | null;
}

/** Keeps a handful of built blocks so riding back does not rebuild them. */
export class ChunkMeshCache {
  private snaps = new Map<string, ChunkSnap>();
  private order: string[] = [];

  get(stamp: string): ChunkSnap | undefined {
    return this.snaps.get(stamp);
  }

  hold(snap: ChunkSnap): void {
    if (this.snaps.has(snap.stamp)) return;
    this.snaps.set(snap.stamp, snap);
    this.order.push(snap.stamp);
  }

  rememberGrids(stamp: string, surface: Uint8Array, height: Uint8Array): void {
    const snap = this.snaps.get(stamp);
    if (!snap) return;
    snap.surface.set(surface);
    snap.height.set(height);
  }

  evict(except: string, max = 5): void {
    while (this.order.length > max) {
      const oldest = this.order.find((stamp) => stamp !== except);
      if (!oldest) return;
      this.order = this.order.filter((stamp) => stamp !== oldest);
      const snap = this.snaps.get(oldest);
      this.snaps.delete(oldest);
      if (!snap) continue;
      snap.group.removeFromParent();
      snap.group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
        for (const m of mats) {
          const mapped = m as THREE.MeshStandardMaterial;
          mapped.map?.dispose();
          m.dispose();
        }
      });
    }
  }
}
