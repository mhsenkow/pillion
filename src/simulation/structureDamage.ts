import * as THREE from 'three';
import { GRID_L, GRID_W, TILE } from '../core/constants';
import type { BuildingClass, ZombieEntity } from '../core/types';
import { gridToWorld, idx, worldToGrid } from '../geo/voxelizer';

export type StructureMaterial = 'wood' | 'brick' | 'concrete';

export interface CollapseEvent {
  gx: number;
  gz: number;
  wx: number;
  wz: number;
  scrap: number;
  voxelCount: number;
  material: StructureMaterial;
  footprintId: number;
}

interface VoxelRef {
  mesh: THREE.InstancedMesh;
  index: number;
  y: number;
}

interface CellMeta {
  material: StructureMaterial;
  footprintId: number;
  voxelCount: number;
}

interface Footprint {
  cells: number[];
  groundGone: number;
  rubble: number;
}

interface Flame {
  gx: number;
  gz: number;
  life: number;
  nextSpread: number;
  sprite: THREE.Sprite;
  material: StructureMaterial;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _color = new THREE.Color();
const _dummy = new THREE.Object3D();

const FIRE_SPREAD: Record<StructureMaterial, number> = {
  wood: 0.34,
  brick: 0.54,
  concrete: 0.82,
};

const FIRE_LIFE: Record<StructureMaterial, number> = {
  wood: 2.15,
  brick: 2.75,
  concrete: 3.35,
};

export function materialFromBuildingClass(cls: BuildingClass): StructureMaterial {
  switch (cls) {
    case 'church':
    case 'retail':
    case 'garage':
      return 'wood';
    case 'school':
    case 'apartments':
      return 'brick';
    case 'industrial':
      return 'concrete';
    default:
      return 'brick';
  }
}

export function materialFromVoxelColor(hex: number): StructureMaterial {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  if (r > 140 && g < 110) return 'wood';
  if (r + g + b < 200) return 'concrete';
  return 'brick';
}

export function scrapForBuildingSize(voxelCount: number, material: StructureMaterial): number {
  const base = Math.max(1, Math.floor(voxelCount * 0.35));
  const mul = material === 'wood' ? 0.85 : material === 'brick' ? 1 : 1.25;
  return Math.min(48, Math.max(2, Math.round(base * mul)));
}

function footprintCollapseRatio(fp: Footprint): number {
  if (!fp.cells.length) return 0;
  return fp.rubble / fp.cells.length;
}

/** Building voxels for the block on screen. Breach opens a column. Firebomb opens a hole and the rest burns down. */
export class StructureField {
  private cells = new Map<number, VoxelRef[]>();
  private meta = new Map<number, CellMeta>();
  private footprints = new Map<number, Footprint>();
  private nextFootprintId = 1;
  private flames: Flame[] = [];
  private key = '';
  private flameMap: THREE.Texture | null = null;
  private light = new THREE.PointLight(0xf97316, 0, 9, 1.6);
  private dirtyMeshes = new Set<THREE.InstancedMesh>();
  private pendingScrap = 0;
  private recentCollapses: CollapseEvent[] = [];

  bind(
    group: THREE.Group,
    surface: Uint8Array,
    chunkKey: string,
    materialHint?: Map<number, StructureMaterial>,
  ): void {
    if (this.key === chunkKey && this.cells.size > 0) return;
    this.clearFlames();
    this.key = chunkKey;
    this.cells.clear();
    this.meta.clear();
    this.footprints.clear();
    this.nextFootprintId = 1;
    this.pendingScrap = 0;
    this.recentCollapses = [];
    group.traverse((obj) => {
      const mesh = obj as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, _m);
        _m.decompose(_p, _q, _s);
        if (_s.x < 0.05 || _p.y < 0.15) continue;
        const { gx, gz } = worldToGrid(_p.x, _p.z);
        if (gx < 0 || gz < 0 || gx >= GRID_W || gz >= GRID_L) continue;
        const cell = idx(gx, gz);
        if (surface[cell] !== TILE.BUILDING) continue;
        const list = this.cells.get(cell) ?? [];
        list.push({ mesh, index: i, y: _p.y });
        this.cells.set(cell, list);
        if (!this.meta.has(cell)) {
          let colorHex = 0x57534e;
          if (mesh.instanceColor) {
            mesh.getColorAt(i, _color);
            colorHex = _color.getHex();
          }
          this.meta.set(cell, {
            material: materialHint?.get(cell) ?? materialFromVoxelColor(colorHex),
            footprintId: -1,
            voxelCount: 0,
          });
        }
      }
    });
    for (const [cell, refs] of this.cells) {
      const m = this.meta.get(cell);
      if (m) m.voxelCount = refs.length;
    }
    this.assignFootprints(surface);
  }

  takePendingScrap(): number {
    const s = this.pendingScrap;
    this.pendingScrap = 0;
    return s;
  }

  drainCollapseEvents(): CollapseEvent[] {
    const out = this.recentCollapses;
    this.recentCollapses = [];
    return out;
  }

  chip(wx: number, wz: number, surface: Uint8Array, height: Uint8Array): number {
    const { gx, gz } = worldToGrid(wx, wz);
    const fell = this.collapse(gx, gz, surface, height) ? 1 : 0;
    this.flush();
    return fell;
  }

  blast(
    wx: number,
    wz: number,
    radius: number,
    ignites: boolean,
    surface: Uint8Array,
    height: Uint8Array,
    parent: THREE.Object3D,
  ): number {
    const { gx, gz } = worldToGrid(wx, wz);
    const r = Math.max(2, radius);
    let fell = 0;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        if (this.collapse(gx + dx, gz + dz, surface, height)) fell++;
      }
    }
    if (ignites) {
      const ring = r + 2;
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          const d2 = dx * dx + dz * dz;
          if (d2 <= r * r || d2 > ring * ring) continue;
          this.ignite(gx + dx, gz + dz, surface, parent);
        }
      }
    }
    this.flush();
    return fell;
  }

  update(
    dt: number,
    surface: Uint8Array,
    height: Uint8Array,
    parent: THREE.Object3D,
    zombies: ZombieEntity[],
    bike: { x: number; z: number; hp: number },
  ): number {
    let fell = 0;
    let touchingBike = false;
    for (let i = this.flames.length - 1; i >= 0; i--) {
      const flame = this.flames[i];
      flame.life -= dt;
      flame.nextSpread -= dt;
      const { wx, wz } = gridToWorld(flame.gx, flame.gz);
      flame.sprite.position.y = 1.15 + Math.sin(flame.life * 14) * 0.18;
      const mat = flame.sprite.material as THREE.SpriteMaterial;
      mat.opacity = Math.max(0.35, Math.min(1, flame.life));
      this.flicker(idx(flame.gx, flame.gz), flame.life);
      if (Math.hypot(wx - bike.x, wz - bike.z) < 0.9) touchingBike = true;
      if (flame.nextSpread <= 0 && this.flames.length < 18) {
        flame.nextSpread = FIRE_SPREAD[flame.material];
        this.spread(flame.gx, flame.gz, surface, parent, flame.material);
      }
      if (flame.life <= 0) {
        if (this.collapse(flame.gx, flame.gz, surface, height)) fell++;
        this.removeFlame(i);
      }
    }
    for (const zombie of zombies) {
      for (const flame of this.flames) {
        const { wx, wz } = gridToWorld(flame.gx, flame.gz);
        if (Math.hypot(zombie.x - wx, zombie.z - wz) < 0.85) {
          zombie.hp -= 28 * dt;
          break;
        }
      }
    }
    if (touchingBike) bike.hp = Math.max(0, bike.hp - 12 * dt);
    if (this.flames.length) {
      if (!this.light.parent) parent.add(this.light);
      const hot = this.flames[0];
      const at = gridToWorld(hot.gx, hot.gz);
      this.light.position.set(at.wx, 1.7, at.wz);
      this.light.intensity = Math.min(2.4, 0.55 + this.flames.length * 0.16);
    } else if (this.light.parent) {
      this.light.parent.remove(this.light);
    }
    this.flush();
    return fell;
  }

  private assignFootprints(surface: Uint8Array): void {
    const seen = new Set<number>();
    for (const cell of this.cells.keys()) {
      if (seen.has(cell)) continue;
      const gx = cell % GRID_W;
      const gz = Math.floor(cell / GRID_W);
      const id = this.nextFootprintId++;
      const fp: Footprint = { cells: [], groundGone: 0, rubble: 0 };
      const queue = [{ gx, gz }];
      while (queue.length) {
        const { gx: x, gz: z } = queue.pop()!;
        const c = idx(x, z);
        if (seen.has(c) || surface[c] !== TILE.BUILDING || !this.cells.has(c)) continue;
        seen.add(c);
        fp.cells.push(c);
        const meta = this.meta.get(c);
        if (meta) meta.footprintId = id;
        queue.push({ gx: x + 1, gz: z }, { gx: x - 1, gz: z }, { gx: x, gz: z + 1 }, { gx: x, gz: z - 1 });
      }
      if (fp.cells.length) this.footprints.set(id, fp);
    }
  }

  private spread(gx: number, gz: number, surface: Uint8Array, parent: THREE.Object3D, from: StructureMaterial): void {
    const options: [number, number][] = [
      [gx + 1, gz],
      [gx - 1, gz],
      [gx, gz + 1],
      [gx, gz - 1],
    ];
    const open = options.filter(([x, z]) => this.canBurn(x, z, surface));
    if (!open.length) return;
    const [nx, nz] = open[Math.floor(Math.random() * open.length)];
    const neighbor = this.meta.get(idx(nx, nz))?.material ?? from;
    this.ignite(nx, nz, surface, parent, neighbor);
  }

  private canBurn(gx: number, gz: number, surface: Uint8Array): boolean {
    if (gx < 1 || gz < 1 || gx >= GRID_W - 1 || gz >= GRID_L - 1) return false;
    const cell = idx(gx, gz);
    if (surface[cell] !== TILE.BUILDING || !this.cells.has(cell)) return false;
    return !this.flames.some((flame) => flame.gx === gx && flame.gz === gz);
  }

  private ignite(gx: number, gz: number, surface: Uint8Array, parent: THREE.Object3D, material?: StructureMaterial): void {
    if (!this.canBurn(gx, gz, surface) || this.flames.length >= 18) return;
    const cell = idx(gx, gz);
    const mat = material ?? this.meta.get(cell)?.material ?? 'brick';
    const { wx, wz } = gridToWorld(gx, gz);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.flameTexture(),
        transparent: true,
        depthWrite: false,
        color: mat === 'wood' ? 0xfff1d6 : mat === 'brick' ? 0xfed7aa : 0xe7e5e4,
      }),
    );
    sprite.position.set(wx, 1.2, wz);
    sprite.scale.set(1.15, 1.7, 1);
    parent.add(sprite);
    this.flames.push({
      gx,
      gz,
      life: FIRE_LIFE[mat],
      nextSpread: FIRE_SPREAD[mat],
      sprite,
      material: mat,
    });
  }

  private collapse(gx: number, gz: number, surface: Uint8Array, height: Uint8Array): boolean {
    if (gx < 0 || gz < 0 || gx >= GRID_W || gz >= GRID_L) return false;
    const cell = idx(gx, gz);
    if (surface[cell] !== TILE.BUILDING) return false;
    const refs = this.cells.get(cell);
    if (!refs?.length) return false;
    const meta = this.meta.get(cell);
    refs.sort((a, b) => a.y - b.y);
    refs.forEach((ref, index) => {
      ref.mesh.getMatrixAt(ref.index, _m);
      _m.decompose(_p, _q, _s);
      if (index === 0) {
        _dummy.position.set(_p.x, 0.07, _p.z);
        _dummy.scale.set(0.3, 0.1, 0.3);
        _color.setHex(0x57534e);
      } else {
        _dummy.position.copy(_p);
        _dummy.scale.set(0, 0, 0);
        _color.setHex(0x1c1917);
      }
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      ref.mesh.setMatrixAt(ref.index, _dummy.matrix);
      ref.mesh.setColorAt(ref.index, _color);
      this.dirtyMeshes.add(ref.mesh);
    });
    surface[cell] = TILE.RUBBLE;
    height[cell] = 1;
    this.cells.delete(cell);

    const material = meta?.material ?? 'brick';
    const voxelCount = meta?.voxelCount ?? refs.length;
    const scrap = scrapForBuildingSize(voxelCount, material);
    this.pendingScrap += scrap;

    const { wx, wz } = gridToWorld(gx, gz);
    const footprintId = meta?.footprintId ?? -1;
    this.recentCollapses.push({ gx, gz, wx, wz, scrap, voxelCount, material, footprintId });

    if (footprintId >= 0) {
      const fp = this.footprints.get(footprintId);
      if (fp) {
        fp.groundGone++;
        fp.rubble++;
        this.maybeCascadeFootprint(footprintId, surface, height);
      }
    }
    this.meta.delete(cell);
    return true;
  }

  private maybeCascadeFootprint(footprintId: number, surface: Uint8Array, height: Uint8Array): void {
    const fp = this.footprints.get(footprintId);
    if (!fp) return;
    const minGround = Math.max(2, Math.ceil(fp.cells.length * 0.28));
    const ratioTrigger = footprintCollapseRatio(fp) >= 0.52;
    const groundTrigger = fp.groundGone >= minGround;
    if (!ratioTrigger && !groundTrigger) return;
    for (const cell of [...fp.cells]) {
      if (surface[cell] !== TILE.BUILDING) continue;
      const gx = cell % GRID_W;
      const gz = Math.floor(cell / GRID_W);
      this.collapse(gx, gz, surface, height);
    }
  }

  private flicker(cell: number, life: number): void {
    const refs = this.cells.get(cell);
    if (!refs) return;
    _color.setHex(Math.sin(life * 22) > 0 ? 0xf97316 : 0x7f1d1d);
    for (const ref of refs) {
      ref.mesh.setColorAt(ref.index, _color);
      this.dirtyMeshes.add(ref.mesh);
    }
  }

  private flush(): void {
    for (const mesh of this.dirtyMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.dirtyMeshes.clear();
  }

  private removeFlame(index: number): void {
    const flame = this.flames[index];
    flame.sprite.removeFromParent();
    flame.sprite.material.dispose();
    this.flames.splice(index, 1);
  }

  private clearFlames(): void {
    while (this.flames.length) this.removeFlame(0);
    this.light.removeFromParent();
  }

  private flameTexture(): THREE.Texture | null {
    if (this.flameMap || typeof document === 'undefined') return this.flameMap;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const g = canvas.getContext('2d');
    if (!g) return null;
    const grad = g.createRadialGradient(16, 18, 1, 16, 16, 15);
    grad.addColorStop(0, 'rgba(255,247,214,0.95)');
    grad.addColorStop(0.35, 'rgba(249,115,22,0.85)');
    grad.addColorStop(1, 'rgba(127,29,29,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.flameMap = tex;
    return tex;
  }
}