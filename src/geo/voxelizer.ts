import * as THREE from 'three';
import {
  GRID_W,
  GRID_L,
  VOXEL_SIZE,
  WORLD_W,
  WORLD_L,
  HALF_W,
  HALF_L,
  TILE,
  CELL_METERS,
} from '../core/constants';
import { hashCoords, mulberry32, type Rng } from '../core/rng';
import type { GisPin, OsmData, OsmLanduse, VoxelSpec } from '../core/types';
import { bboxFromCenter, type GeoBBox } from './projection';
import { EMMETT_GIS } from './emmettGis';
import {
  buildRuinedCar,
  buildToxicBarrel,
  buildScrapPile,
  buildStreetLamp,
} from '../art/zombieBuilder';

export function idx(gx: number, gz: number): number {
  return gz * GRID_W + gx;
}

export function worldToGrid(wx: number, wz: number): { gx: number; gz: number } {
  const gx = Math.floor((wx + HALF_W) / VOXEL_SIZE);
  const gz = Math.floor((wz + HALF_L) / VOXEL_SIZE);
  return {
    gx: Math.max(0, Math.min(GRID_W - 1, gx)),
    gz: Math.max(0, Math.min(GRID_L - 1, gz)),
  };
}

export function gridToWorld(gx: number, gz: number): { wx: number; wz: number } {
  return {
    wx: (gx + 0.5) * VOXEL_SIZE - HALF_W,
    wz: (gz + 0.5) * VOXEL_SIZE - HALF_L,
  };
}

function distToSegment(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
  const l2 = (x2 - x1) ** 2 + (z2 - z1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, pz - z1);
  let t = ((px - x1) * (x2 - x1) + (pz - z1) * (z2 - z1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), pz - (z1 + t * (z2 - z1)));
}

function pointInPolygon(px: number, pz: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0],
      zi = poly[i][1];
    const xj = poly[j][0],
      zj = poly[j][1];
    const intersect =
      zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi || 1e-7) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface ChunkBuildResult {
  solid: VoxelSpec[];
  glass: VoxelSpec[];
  pins: GisPin[];
  props: THREE.Object3D[];
  banner: string;
  poiLabel: string;
  sourceTag: string;
}

export interface ChunkContext {
  baseLat: number;
  baseLon: number;
  chunkX: number;
  chunkZ: number;
  curLat: number;
  curLon: number;
  showMapLayer: boolean;
  biomeHint?: string;
  surfaceGrid: Uint8Array;
  heightGrid: Uint8Array;
  osm: OsmData | null;
  bbox?: GeoBBox;
}

function paintPoly(
  ctx: ChunkContext,
  poly: [number, number][],
  tile: number,
  skip: number[] = [TILE.WATER, TILE.BUILDING, TILE.ROAD, TILE.RAIL, TILE.BRIDGE],
): void {
  if (poly.length < 3) return;
  let minX = GRID_W,
    maxX = 0,
    minZ = GRID_L,
    maxZ = 0;
  poly.forEach(([px, pz]) => {
    minX = Math.min(minX, Math.floor(px));
    maxX = Math.max(maxX, Math.ceil(px));
    minZ = Math.min(minZ, Math.floor(pz));
    maxZ = Math.max(maxZ, Math.ceil(pz));
  });
  minX = Math.max(0, minX);
  maxX = Math.min(GRID_W - 1, maxX);
  minZ = Math.max(0, minZ);
  maxZ = Math.min(GRID_L - 1, maxZ);
  for (let gz = minZ; gz <= maxZ; gz++) {
    for (let gx = minX; gx <= maxX; gx++) {
      if (!pointInPolygon(gx + 0.5, gz + 0.5, poly)) continue;
      const cIdx = idx(gx, gz);
      if (skip.includes(ctx.surfaceGrid[cIdx])) continue;
      ctx.surfaceGrid[cIdx] = tile;
    }
  }
}

function paintLanduse(ctx: ChunkContext, landuse: OsmLanduse[] | undefined): void {
  if (!landuse) return;
  const keepInfra = [TILE.WATER, TILE.ROAD, TILE.RAIL, TILE.BRIDGE, TILE.BUILDING];
  for (const lu of landuse) {
    if (lu.kind === 'residential' || lu.kind === 'forest' || lu.kind === 'park') {
      paintPoly(ctx, lu.poly, TILE.FIELD, [...keepInfra, TILE.SIDEWALK, TILE.PARKING]);
    } else if (lu.kind === 'commercial') {
      paintPoly(ctx, lu.poly, TILE.SIDEWALK, keepInfra);
      mixPoly(ctx, lu.poly, TILE.PARKING, TILE.SIDEWALK, 6);
    } else if (lu.kind === 'industrial') {
      paintPoly(ctx, lu.poly, TILE.TOXIC, keepInfra);
      mixPoly(ctx, lu.poly, TILE.RUBBLE, TILE.TOXIC, 4);
    }
  }
}

function findOpenPad(ctx: ChunkContext, gx: number, gz: number): { gx: number; gz: number } | null {
  const blocked = (x: number, z: number) => {
    if (x < 2 || z < 2 || x >= GRID_W - 3 || z >= GRID_L - 5) return true;
    const t = ctx.surfaceGrid[idx(x, z)];
    return t === TILE.ROAD || t === TILE.WATER || t === TILE.RAIL || t === TILE.BRIDGE || t === TILE.BUILDING;
  };
  if (!blocked(gx, gz)) return { gx, gz };
  for (let r = 1; r <= 7; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = gx + dx;
        const z = gz + dz;
        if (!blocked(x, z)) return { gx: x, gz: z };
      }
    }
  }
  return null;
}

/** Low unknown pads from addresses / shops when OSM has roads but almost no footprints. */
function inferSparseLots(
  ctx: ChunkContext,
  osm: OsmData,
  rng: Rng,
  solid: VoxelSpec[],
  glass: VoxelSpec[],
  pins: GisPin[],
): void {
  const seeds: { gx: number; gz: number; label: string }[] = [];
  for (const poi of osm.pois) {
    if (poi.kind !== 'addr' && poi.kind !== 'shop' && poi.kind !== 'cafe' && poi.kind !== 'fuel') continue;
    seeds.push({
      gx: Math.round(poi.gx),
      gz: Math.round(poi.gz),
      label: poi.name || (poi.kind === 'addr' ? '' : poi.kind.toUpperCase()),
    });
  }
  let placed = 0;
  for (const seed of seeds) {
    if (placed >= 28) break;
    const spot = findOpenPad(ctx, seed.gx, seed.gz);
    if (!spot) continue;
    const w = 3;
    const d = 4;
    const cells: [number, number][] = [];
    for (let z = spot.gz; z < spot.gz + d; z++) {
      for (let x = spot.gx; x < spot.gx + w; x++) {
        if (x < 1 || z < 1 || x >= GRID_W - 1 || z >= GRID_L - 1) continue;
        const cIdx = idx(x, z);
        const t = ctx.surfaceGrid[cIdx];
        if (t === TILE.ROAD || t === TILE.WATER || t === TILE.RAIL || t === TILE.BRIDGE || t === TILE.BUILDING) {
          continue;
        }
        ctx.surfaceGrid[cIdx] = TILE.BUILDING;
        cells.push([x, z]);
      }
    }
    if (cells.length < 4) {
      cells.forEach(([x, z]) => {
        if (ctx.surfaceGrid[idx(x, z)] === TILE.BUILDING) ctx.surfaceGrid[idx(x, z)] = TILE.FIELD;
      });
      continue;
    }
    const colH = 5;
    const color = 0x57534e;
    cells.forEach(([gx, gz]) => {
      const isWall =
        ctx.surfaceGrid[idx(gx - 1, gz)] !== TILE.BUILDING ||
        ctx.surfaceGrid[idx(gx + 1, gz)] !== TILE.BUILDING ||
        ctx.surfaceGrid[idx(gx, gz - 1)] !== TILE.BUILDING ||
        ctx.surfaceGrid[idx(gx, gz + 1)] !== TILE.BUILDING;
      ctx.heightGrid[idx(gx, gz)] = colH;
      extrudeCell(gx, gz, isWall, false, colH, color, 0x27272a, rng, solid, glass);
    });
    if (seed.label) {
      const [cx, cz] = cells[Math.floor(cells.length / 2)];
      const { wx, wz } = gridToWorld(cx, cz);
      pins.push({
        label: seed.label,
        wx,
        wy: 1.15,
        wz,
        type: /^\d/.test(seed.label) ? 'addr' : 'building',
      });
    }
    placed++;
  }
}

function mixPoly(ctx: ChunkContext, poly: [number, number][], tile: number, only: number, period: number): void {
  if (poly.length < 3) return;
  let minX = GRID_W,
    maxX = 0,
    minZ = GRID_L,
    maxZ = 0;
  poly.forEach(([px, pz]) => {
    minX = Math.min(minX, Math.floor(px));
    maxX = Math.max(maxX, Math.ceil(px));
    minZ = Math.min(minZ, Math.floor(pz));
    maxZ = Math.max(maxZ, Math.ceil(pz));
  });
  minX = Math.max(0, minX);
  maxX = Math.min(GRID_W - 1, maxX);
  minZ = Math.max(0, minZ);
  maxZ = Math.min(GRID_L - 1, maxZ);
  for (let gz = minZ; gz <= maxZ; gz++) {
    for (let gx = minX; gx <= maxX; gx++) {
      if ((gx + gz) % period !== 0) continue;
      if (!pointInPolygon(gx + 0.5, gz + 0.5, poly)) continue;
      const cIdx = idx(gx, gz);
      if (ctx.surfaceGrid[cIdx] === only) ctx.surfaceGrid[cIdx] = tile;
    }
  }
}

function extrudeCell(
  gx: number,
  gz: number,
  isWall: boolean,
  isCorner: boolean,
  colH: number,
  baseColor: number,
  roofColor: number,
  rng: Rng,
  solid: VoxelSpec[],
  glass: VoxelSpec[],
): void {
  const { wx, wz } = gridToWorld(gx, gz);
  for (let y = 1; y <= colH; y++) {
    if (!isWall && y < colH) continue;
    const vy = (y - 0.5) * VOXEL_SIZE;
    const isWindowRow = y > 2 && y < colH - 1 && y % 3 === 0;
    const isWindowCol = !isCorner && (gx + gz) % 2 === 0;
    if (isWall && isWindowRow && isWindowCol) {
      if (rng() < 0.22) {
        glass.push({
          x: wx,
          y: vy,
          z: wz,
          sx: VOXEL_SIZE * 0.8,
          sy: VOXEL_SIZE * 0.8,
          sz: VOXEL_SIZE * 0.8,
          color: 0xfde047,
        });
      }
      continue;
    }
    let c = baseColor;
    if (isCorner) c = 0x334155;
    if (y === 1) c = 0x27272a;
    if (y === colH) c = rng() < 0.38 ? 0x3f6212 : roofColor || 0x1e293b;
    const roof = y === colH;
    solid.push({
      x: wx,
      y: vy,
      z: wz,
      sx: roof ? VOXEL_SIZE * 1.16 : VOXEL_SIZE,
      sy: roof ? VOXEL_SIZE * 0.72 : VOXEL_SIZE,
      sz: roof ? VOXEL_SIZE * 1.16 : VOXEL_SIZE,
      color: c,
    });
    if (roof && isCorner && colH >= 12 && (gx * 3 + gz) % 11 === 0) {
      solid.push({
        x: wx,
        y: vy + VOXEL_SIZE * 0.7,
        z: wz,
        sx: VOXEL_SIZE * 0.28,
        sy: VOXEL_SIZE * 0.9,
        sz: VOXEL_SIZE * 0.28,
        color: 0xfbbf24,
      });
    }
  }
}

function budgetBuildings<T extends { poly: [number, number][] }>(buildings: T[]): T[] {
  const CAP = 64;
  if (buildings.length <= CAP) return buildings;
  const cx = GRID_W / 2;
  const cz = GRID_L / 2;
  return buildings
    .map((b) => {
      let minX = GRID_W;
      let maxX = 0;
      let minZ = GRID_L;
      let maxZ = 0;
      for (const [x, z] of b.poly) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      const area = Math.max(0, maxX - minX) * Math.max(0, maxZ - minZ);
      const dist = Math.hypot((minX + maxX) / 2 - cx, (minZ + maxZ) / 2 - cz);
      return { b, score: area * 3 - dist };
    })
    .sort((a, c) => c.score - a.score)
    .slice(0, CAP)
    .map((row) => row.b);
}

function paintGroundSheet(surface: Uint8Array): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = GRID_W;
  canvas.height = GRID_L;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('ground canvas unavailable');
  const img = g.createImageData(GRID_W, GRID_L);
  const data = img.data;
  for (let i = 0; i < surface.length; i++) {
    const gx = i % GRID_W;
    const gz = (i / GRID_W) | 0;
    const tile = surface[i];
    let color = 0x3a5224;
    if (tile === TILE.ROAD || tile === TILE.BRIDGE) color = 0x2a3140;
    else if (tile === TILE.SIDEWALK) color = 0x6b7585;
    else if (tile === TILE.WATER) color = 0x115e59;
    else if (tile === TILE.RAIL) color = 0x44403c;
    else if (tile === TILE.PARKING) color = 0x334155;
    else if (tile === TILE.TOXIC) color = 0x3f6212;
    else if (tile === TILE.BUILDING) color = 0x292524;
    else if (tile === TILE.RUBBLE) color = 0x57534e;
    const n = ((gx * 13 + gz * 7) & 7) - 3;
    const o = i * 4;
    data[o] = Math.max(0, Math.min(255, ((color >> 16) & 255) + n));
    data[o + 1] = Math.max(0, Math.min(255, ((color >> 8) & 255) + n));
    data[o + 2] = Math.max(0, Math.min(255, (color & 255) + n));
    data[o + 3] = 255;
    if ((tile === TILE.ROAD || tile === TILE.BRIDGE) && gz % 5 < 2 && (gx & 1) === 0) {
      data[o] = 190;
      data[o + 1] = 130;
      data[o + 2] = 42;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(WORLD_W, WORLD_L);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.94, metalness: 0.02 }),
  );
  mesh.position.y = -0.16;
  mesh.receiveShadow = true;
  mesh.name = 'ground-sheet';
  return mesh;
}

function addRailsAndCurbs(ctx: ChunkContext, solid: VoxelSpec[]): void {
  const roadish = (t: number) => t === TILE.ROAD || t === TILE.BRIDGE || t === TILE.RAIL;
  for (let gz = 1; gz < GRID_L - 1; gz++) {
    for (let gx = 1; gx < GRID_W - 1; gx++) {
      const tile = ctx.surfaceGrid[idx(gx, gz)];
      const { wx, wz } = gridToWorld(gx, gz);
      if (tile === TILE.RAIL && (gx & 1) === 0) {
        solid.push({
          x: wx,
          y: 0.06,
          z: wz,
          sx: VOXEL_SIZE * 0.85,
          sy: 0.08,
          sz: VOXEL_SIZE * 0.28,
          color: 0xa8a29e,
        });
      }
      if (tile !== TILE.ROAD && tile !== TILE.BRIDGE) continue;
      const edge =
        !roadish(ctx.surfaceGrid[idx(gx - 1, gz)]) ||
        !roadish(ctx.surfaceGrid[idx(gx + 1, gz)]) ||
        !roadish(ctx.surfaceGrid[idx(gx, gz - 1)]) ||
        !roadish(ctx.surfaceGrid[idx(gx, gz + 1)]);
      if (edge && ((gx + gz) & 1) === 0) {
        solid.push({
          x: wx,
          y: 0.02,
          z: wz,
          sx: VOXEL_SIZE * 0.9,
          sy: 0.08,
          sz: VOXEL_SIZE * 0.9,
          color: 0x94a3b8,
        });
      }
    }
  }
}

function makeTree(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'field-tree';
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x44403c, roughness: 0.9 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x3f6212, roughness: 0.85 });
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.14), trunkMat);
  trunk.position.y = 0.28;
  const crown = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.48, 0.62), crownMat);
  crown.position.y = 0.72;
  g.add(trunk, crown);
  return g;
}

/** A roads-only or empty download still gets a track and a tree line. */
function dressThinPlace(ctx: ChunkContext, rng: Rng, props: THREE.Object3D[]): void {
  let roads = 0;
  let buildings = 0;
  for (let i = 0; i < ctx.surfaceGrid.length; i++) {
    const t = ctx.surfaceGrid[i];
    if (t === TILE.ROAD || t === TILE.BRIDGE) roads++;
    else if (t === TILE.BUILDING) buildings++;
  }
  if (roads < 30) {
    for (let gz = 1; gz < GRID_L - 1; gz++) {
      for (let gx = 37; gx <= 43; gx++) {
        const i = idx(gx, gz);
        const t = ctx.surfaceGrid[i];
        if (t === TILE.BUILDING || t === TILE.WATER) continue;
        ctx.surfaceGrid[i] = gx >= 39 && gx <= 41 ? TILE.ROAD : TILE.SIDEWALK;
      }
    }
  }
  if (buildings >= 12) return;
  let trees = 0;
  for (let n = 0; n < 90 && trees < 16; n++) {
    const gx = 2 + Math.floor(rng() * (GRID_W - 4));
    const gz = 2 + Math.floor(rng() * (GRID_L - 4));
    const t = ctx.surfaceGrid[idx(gx, gz)];
    if (t !== TILE.FIELD && t !== TILE.RUBBLE) continue;
    const beside =
      ctx.surfaceGrid[idx(gx - 1, gz)] === TILE.ROAD ||
      ctx.surfaceGrid[idx(gx + 1, gz)] === TILE.ROAD ||
      ctx.surfaceGrid[idx(gx, gz - 1)] === TILE.ROAD ||
      ctx.surfaceGrid[idx(gx, gz + 1)] === TILE.ROAD ||
      ctx.surfaceGrid[idx(gx - 1, gz)] === TILE.SIDEWALK ||
      ctx.surfaceGrid[idx(gx + 1, gz)] === TILE.SIDEWALK;
    if (!beside) continue;
    const tree = makeTree();
    const { wx, wz } = gridToWorld(gx, gz);
    tree.position.set(wx, 0, wz);
    tree.rotation.y = rng() * Math.PI;
    props.push(tree);
    trees++;
  }
}

export function generateChunkData(ctx: ChunkContext): ChunkBuildResult {
  const solid: VoxelSpec[] = [];
  const glass: VoxelSpec[] = [];
  const pins: GisPin[] = [];
  const props: THREE.Object3D[] = [];
  const seed = hashCoords(ctx.baseLat, ctx.baseLon, ctx.chunkX, ctx.chunkZ);
  const rng = mulberry32(seed);

  const isEmmettOrigin =
    Math.abs(ctx.curLat - 42.9906) < 0.0055 && Math.abs(ctx.curLon - -82.7649) < 0.0055;

  ctx.surfaceGrid.fill(TILE.FIELD);
  ctx.heightGrid.fill(0);

  let banner = `BLOCK [${ctx.chunkX}, ${ctx.chunkZ}]`;
  let poiLabel = 'SECTOR';
  let sourceTag = '80×160 SYNTH';

  // Perimeter rim
  for (let gz = 0; gz < GRID_L; gz++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      if (!(gx === 0 || gx === GRID_W - 1 || gz === 0 || gz === GRID_L - 1)) continue;
      const { wx, wz } = gridToWorld(gx, gz);
      solid.push({ x: wx, y: -1.65, z: wz, sx: VOXEL_SIZE, sy: 1.1, sz: VOXEL_SIZE, color: 0x1e222d });
      const isCulvert = (gz === 0 || gz === GRID_L - 1) && gx >= 38 && gx <= 41;
      if (!isCulvert) {
        solid.push({ x: wx, y: -0.75, z: wz, sx: VOXEL_SIZE, sy: 0.85, sz: VOXEL_SIZE, color: 0x3b2d26 });
      } else {
        glass.push({ x: wx, y: -0.95, z: wz, sx: VOXEL_SIZE, sy: 0.35, sz: VOXEL_SIZE, color: 0x4ade80 });
      }
    }
  }

  const osm = ctx.osm;
  const hasOsm =
    !!osm &&
    (osm.roads.length > 0 ||
      osm.buildings.length > 0 ||
      osm.railways.length > 0 ||
      (osm.landuse?.length ?? 0) > 0 ||
      (osm.pois?.length ?? 0) > 0);
  if (hasOsm && osm) {
    sourceTag = `${CELL_METERS}m OSM (${osm.buildings.length}B/${osm.roads.length}R)`;
    if (osm.streetNames.length > 0) {
      banner = osm.streetNames.slice(0, 2).join(' • ').toUpperCase();
      poiLabel = osm.streetNames[0].toUpperCase();
    }

    osm.waterways.forEach((way) => {
      const closed =
        way.points.length >= 4 &&
        Math.hypot(
          way.points[0][0] - way.points[way.points.length - 1][0],
          way.points[0][1] - way.points[way.points.length - 1][1],
        ) < 1.5;
      if (closed) {
        let minX = GRID_W,
          maxX = 0,
          minZ = GRID_L,
          maxZ = 0;
        way.points.forEach(([px, pz]) => {
          minX = Math.min(minX, Math.floor(px));
          maxX = Math.max(maxX, Math.ceil(px));
          minZ = Math.min(minZ, Math.floor(pz));
          maxZ = Math.max(maxZ, Math.ceil(pz));
        });
        minX = Math.max(0, minX - 1);
        maxX = Math.min(GRID_W - 1, maxX + 1);
        minZ = Math.max(0, minZ - 1);
        maxZ = Math.min(GRID_L - 1, maxZ + 1);
        for (let gz = minZ; gz <= maxZ; gz++) {
          for (let gx = minX; gx <= maxX; gx++) {
            if (pointInPolygon(gx + 0.5, gz + 0.5, way.points)) {
              ctx.surfaceGrid[idx(gx, gz)] = TILE.WATER;
            }
          }
        }
      }
      for (let i = 0; i < way.points.length - 1; i++) {
        const [x1, z1] = way.points[i];
        const [x2, z2] = way.points[i + 1];
        const minX = Math.max(0, Math.floor(Math.min(x1, x2) - 7));
        const maxX = Math.min(GRID_W - 1, Math.ceil(Math.max(x1, x2) + 7));
        const minZ = Math.max(0, Math.floor(Math.min(z1, z2) - 7));
        const maxZ = Math.min(GRID_L - 1, Math.ceil(Math.max(z1, z2) + 7));
        for (let gz = minZ; gz <= maxZ; gz++) {
          for (let gx = minX; gx <= maxX; gx++) {
            if (distToSegment(gx + 0.5, gz + 0.5, x1, z1, x2, z2) <= 5.5) {
              ctx.surfaceGrid[idx(gx, gz)] = TILE.WATER;
            }
          }
        }
      }
    });

    const pinnedRoads = new Set<string>();
    osm.roads.forEach((road) => {
      for (let i = 0; i < road.points.length - 1; i++) {
        const [x1, z1] = road.points[i];
        const [x2, z2] = road.points[i + 1];
        const minX = Math.max(0, Math.floor(Math.min(x1, x2) - road.halfWidth - 3));
        const maxX = Math.min(GRID_W - 1, Math.ceil(Math.max(x1, x2) + road.halfWidth + 3));
        const minZ = Math.max(0, Math.floor(Math.min(z1, z2) - road.halfWidth - 3));
        const maxZ = Math.min(GRID_L - 1, Math.ceil(Math.max(z1, z2) + road.halfWidth + 3));
        for (let gz = minZ; gz <= maxZ; gz++) {
          for (let gx = minX; gx <= maxX; gx++) {
            const d = distToSegment(gx + 0.5, gz + 0.5, x1, z1, x2, z2);
            const cIdx = idx(gx, gz);
            if (d <= road.halfWidth) {
              if (road.footpath) {
                if (ctx.surfaceGrid[cIdx] !== TILE.ROAD && ctx.surfaceGrid[cIdx] !== TILE.BRIDGE) {
                  ctx.surfaceGrid[cIdx] = TILE.SIDEWALK;
                }
              } else {
                ctx.surfaceGrid[cIdx] =
                  ctx.surfaceGrid[cIdx] === TILE.WATER ? TILE.BRIDGE : TILE.ROAD;
              }
            } else if (
              !road.footpath &&
              d <= road.halfWidth + 2.2 &&
              ctx.surfaceGrid[cIdx] !== TILE.ROAD &&
              ctx.surfaceGrid[cIdx] !== TILE.BRIDGE
            ) {
              ctx.surfaceGrid[cIdx] = TILE.SIDEWALK;
            }
          }
        }
      }
      if (road.name && !pinnedRoads.has(road.name) && road.points.length > 0) {
        pinnedRoads.add(road.name);
        const mid = road.points[Math.floor(road.points.length / 2)];
        if (mid[0] >= 2 && mid[0] <= GRID_W - 2 && mid[1] >= 2 && mid[1] <= GRID_L - 2) {
          const { wx, wz } = gridToWorld(mid[0], mid[1]);
          pins.push({ label: road.name, wx, wy: 0.6, wz, type: 'road' });
        }
      }
    });

    paintLanduse(ctx, osm.landuse);

    osm.railways.forEach((rail) => {
      for (let i = 0; i < rail.points.length - 1; i++) {
        const [x1, z1] = rail.points[i];
        const [x2, z2] = rail.points[i + 1];
        const minX = Math.max(0, Math.floor(Math.min(x1, x2) - 5));
        const maxX = Math.min(GRID_W - 1, Math.ceil(Math.max(x1, x2) + 5));
        const minZ = Math.max(0, Math.floor(Math.min(z1, z2) - 5));
        const maxZ = Math.min(GRID_L - 1, Math.ceil(Math.max(z1, z2) + 5));
        for (let gz = minZ; gz <= maxZ; gz++) {
          for (let gx = minX; gx <= maxX; gx++) {
            const d = distToSegment(gx + 0.5, gz + 0.5, x1, z1, x2, z2);
            if (d <= 2.2) ctx.surfaceGrid[idx(gx, gz)] = TILE.RAIL;
            else if (d <= 3.8 && ctx.surfaceGrid[idx(gx, gz)] === TILE.FIELD) {
              ctx.surfaceGrid[idx(gx, gz)] = TILE.SIDEWALK;
            }
          }
        }
      }
    });

    const palette = [0x7c2d12, 0x475569, 0x64483a, 0x991b1b, 0x52525b, 0x334155];
    budgetBuildings(osm.buildings).forEach((bldg, bIdx) => {
      const cls = bldg.buildingClass || 'generic';
      const baseColor =
        bldg.colour ??
        (cls === 'church'
          ? 0x9a3412
          : cls === 'industrial'
            ? 0x52525b
            : cls === 'retail'
              ? 0x64483a
              : cls === 'school'
                ? 0x475569
                : palette[bIdx % palette.length]);
      const roofColor = cls === 'retail' ? 0x1e293b : 0x27272a;
      let maxH = bldg.levels ? Math.min(16, Math.max(4, bldg.levels * 2)) : 8;
      if (cls === 'garage') maxH = Math.min(maxH, 5);
      if (cls === 'apartments' && !bldg.levels) maxH = 18;
      if (cls === 'industrial' && !bldg.levels) maxH = 8;
      let minX = GRID_W,
        maxX = 0,
        minZ = GRID_L,
        maxZ = 0;
      bldg.poly.forEach(([px, pz]) => {
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minZ = Math.min(minZ, pz);
        maxZ = Math.max(maxZ, pz);
      });
      minX = Math.max(1, Math.floor(minX));
      maxX = Math.min(GRID_W - 2, Math.ceil(maxX));
      minZ = Math.max(1, Math.floor(minZ));
      maxZ = Math.min(GRID_L - 2, Math.ceil(maxZ));
      const footprint: [number, number][] = [];
      for (let gz = minZ; gz <= maxZ; gz++) {
        for (let gx = minX; gx <= maxX; gx++) {
          if (!pointInPolygon(gx + 0.5, gz + 0.5, bldg.poly)) continue;
          if (bldg.inners?.some((inner) => inner.length >= 3 && pointInPolygon(gx + 0.5, gz + 0.5, inner))) {
            continue;
          }
          const cIdx = idx(gx, gz);
          if (ctx.surfaceGrid[cIdx] === TILE.ROAD || ctx.surfaceGrid[cIdx] === TILE.RAIL) continue;
          ctx.surfaceGrid[cIdx] = TILE.BUILDING;
          footprint.push([gx, gz]);
        }
      }
      footprint.forEach(([gx, gz]) => {
        const isWall =
          ctx.surfaceGrid[idx(gx - 1, gz)] !== TILE.BUILDING ||
          ctx.surfaceGrid[idx(gx + 1, gz)] !== TILE.BUILDING ||
          ctx.surfaceGrid[idx(gx, gz - 1)] !== TILE.BUILDING ||
          ctx.surfaceGrid[idx(gx, gz + 1)] !== TILE.BUILDING;
        const isCorner = (gx === minX || gx === maxX) && (gz === minZ || gz === maxZ);
        const colH = Math.max(cls === 'garage' ? 4 : 5, Math.floor(maxH));
        ctx.heightGrid[idx(gx, gz)] = colH;
        extrudeCell(gx, gz, isWall, isCorner, colH, baseColor, roofColor, rng, solid, glass);
      });
      if (cls === 'church' && footprint.length > 4) {
        const [cx, cz] = footprint[Math.floor(footprint.length / 2)];
        for (let sy = maxH + 1; sy <= maxH + 10; sy++) {
          const { wx, wz } = gridToWorld(cx, cz);
          solid.push({
            x: wx,
            y: (sy - 0.5) * VOXEL_SIZE,
            z: wz,
            sx: VOXEL_SIZE * (sy > maxH + 6 ? 0.45 : 0.7),
            sy: VOXEL_SIZE,
            sz: VOXEL_SIZE * (sy > maxH + 6 ? 0.45 : 0.7),
            color: sy > maxH + 8 ? 0xfbbf24 : 0xd6d3d1,
          });
        }
      }
      if (bldg.name && footprint.length > 4) {
        const [cx, cz] = footprint[Math.floor(footprint.length / 2)];
        const { wx, wz } = gridToWorld(cx, cz);
        pins.push({ label: bldg.name, wx, wy: (maxH + 2) * VOXEL_SIZE, wz, type: 'building' });
      } else if (
        bldg.housenumber &&
        footprint.length > 2 &&
        pins.filter((p) => p.type === 'addr').length < 8
      ) {
        const [cx, cz] = footprint[Math.floor(footprint.length / 2)];
        if (Math.hypot(cx - GRID_W / 2, cz - GRID_L / 2) > 24) return;
        const { wx, wz } = gridToWorld(cx, cz);
        pins.push({ label: bldg.housenumber, wx, wy: 1.2, wz, type: 'addr' });
      }
    });
  }

  // Emmett verified cadastral — always blend on the home chunk.
  // OSM in rural MI often has roads but ~0 building footprints; cadastral fills that gap
  // without inventing a fake orthogonal city elsewhere.
  if (isEmmettOrigin && ctx.chunkX === 0 && ctx.chunkZ === 0) {
    const osmHadRoads = !!(osm && osm.roads.length > 0);
    const osmHadBuildings = !!(osm && osm.buildings.length >= 3);
    banner = EMMETT_GIS.banner;
    poiLabel = EMMETT_GIS.poiLabel;
    sourceTag = osmHadRoads
      ? `EMMETT CADASTRAL + OSM (${osm!.buildings.length}B/${osm!.roads.length}R)`
      : 'EMMETT CADASTRAL (verified)';

    // Roads: prefer live OSM if present; otherwise paint cadastral M-19 / Brandon grid
    if (!osmHadRoads) {
      EMMETT_GIS.roads.forEach((road) => {
        const [p1, p2] = road.points;
        for (let gz = 0; gz < GRID_L; gz++) {
          for (let gx = 0; gx < GRID_W; gx++) {
            const d = distToSegment(gx + 0.5, gz + 0.5, p1[0], p1[1], p2[0], p2[1]);
            const cIdx = idx(gx, gz);
            if (d <= road.halfWidth) ctx.surfaceGrid[cIdx] = TILE.ROAD;
            else if (d <= road.halfWidth + 2.5 && ctx.surfaceGrid[cIdx] !== TILE.ROAD) {
              ctx.surfaceGrid[cIdx] = TILE.SIDEWALK;
            }
          }
        }
        const { wx, wz } = gridToWorld((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2);
        pins.push({ label: road.name, wx, wy: 0.65, wz, type: 'road' });
      });

      EMMETT_GIS.railways.forEach((rail) => {
        const [p1, p2] = rail.points;
        for (let gz = 0; gz < GRID_L; gz++) {
          for (let gx = 0; gx < GRID_W; gx++) {
            const d = distToSegment(gx + 0.5, gz + 0.5, p1[0], p1[1], p2[0], p2[1]);
            if (d <= 2.2) ctx.surfaceGrid[idx(gx, gz)] = TILE.RAIL;
            else if (d <= 4.0 && ctx.surfaceGrid[idx(gx, gz)] === TILE.FIELD) {
              ctx.surfaceGrid[idx(gx, gz)] = TILE.SIDEWALK;
            }
          }
        }
        const { wx, wz } = gridToWorld(58, 123);
        pins.push({ label: rail.name, wx, wy: 0.7, wz, type: 'road' });
      });
    }

    // Buildings: always use cadastral when OSM building coverage is sparse
    if (!osmHadBuildings) {
      EMMETT_GIS.buildings.forEach((b) => {
        for (let gz = b.z0; gz <= b.z1; gz++) {
          for (let gx = b.x0; gx <= b.x1; gx++) {
            const cIdx = idx(gx, gz);
            if (ctx.surfaceGrid[cIdx] === TILE.ROAD || ctx.surfaceGrid[cIdx] === TILE.RAIL) continue;
            ctx.surfaceGrid[cIdx] = TILE.BUILDING;
          }
        }
        for (let gz = b.z0; gz <= b.z1; gz++) {
          for (let gx = b.x0; gx <= b.x1; gx++) {
            if (ctx.surfaceGrid[idx(gx, gz)] !== TILE.BUILDING) continue;
            const isWall = gx === b.x0 || gx === b.x1 || gz === b.z0 || gz === b.z1;
            const isCorner = (gx === b.x0 || gx === b.x1) && (gz === b.z0 || gz === b.z1);
            const colH = Math.max(6, Math.floor(b.height - rng() * 3));
            ctx.heightGrid[idx(gx, gz)] = colH;
            extrudeCell(gx, gz, isWall, isCorner, colH, b.color, b.roofColor, rng, solid, glass);
          }
        }
        if (b.convenience) {
          const { wx, wz } = gridToWorld((b.x0 + b.x1) / 2, b.z0);
          solid.push({ x: wx, y: (b.height + 2) * VOXEL_SIZE, z: wz, sx: 2.2, sy: 0.35, sz: 0.2, color: 0x16a34a });
          solid.push({ x: wx, y: (b.height + 2.8) * VOXEL_SIZE, z: wz, sx: 2.2, sy: 0.2, sz: 0.2, color: 0xf97316 });
          solid.push({ x: wx, y: (b.height + 3.4) * VOXEL_SIZE, z: wz, sx: 2.2, sy: 0.2, sz: 0.2, color: 0xdc2626 });
        }
        if (b.steeple) {
          for (let sy = b.height + 1; sy <= b.height + 16; sy++) {
            const spireRadius = sy > b.height + 8 ? 0 : 1;
            for (let dz = -spireRadius; dz <= spireRadius; dz++) {
              for (let dx = -spireRadius; dx <= spireRadius; dx++) {
                const { wx, wz } = gridToWorld(b.x1 - 2 + dx, b.z1 - 2 + dz);
                solid.push({
                  x: wx,
                  y: (sy - 0.5) * VOXEL_SIZE,
                  z: wz,
                  sx: VOXEL_SIZE,
                  sy: VOXEL_SIZE,
                  sz: VOXEL_SIZE,
                  color: sy > b.height + 10 ? 0xfbbf24 : 0xd6d3d1,
                });
              }
            }
          }
        }
        if (b.silo) {
          const siloCenters = [
            [b.x0 - 3, b.z0 + 4],
            [b.x0 - 3, b.z0 + 11],
            [b.x0 - 3, b.z0 + 18],
          ];
          siloCenters.forEach(([sx, sz]) => {
            for (let gz = sz - 2; gz <= sz + 2; gz++) {
              for (let gx = sx - 2; gx <= sx + 2; gx++) {
                if (Math.hypot(gx - sx, gz - sz) <= 2.3 && gx >= 1 && gz < GRID_L - 1) {
                  ctx.surfaceGrid[idx(gx, gz)] = TILE.BUILDING;
                  const { wx, wz } = gridToWorld(gx, gz);
                  for (let sy = 1; sy <= b.height + 8; sy++) {
                    solid.push({
                      x: wx,
                      y: (sy - 0.5) * VOXEL_SIZE,
                      z: wz,
                      sx: VOXEL_SIZE,
                      sy: VOXEL_SIZE,
                      sz: VOXEL_SIZE,
                      color: sy % 6 === 0 ? 0x64748b : 0x94a3b8,
                    });
                  }
                }
              }
            }
          });
        }
        const { wx, wz } = gridToWorld((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
        pins.push({ label: b.name, wx, wy: (b.height + 3) * VOXEL_SIZE, wz, type: 'building' });
      });
    }
  } else if (!osm || (osm.roads.length === 0 && osm.buildings.length === 0)) {
    // Do NOT invent a fake orthogonal city — empty pasture makes missing GIS obvious on radar
    sourceTag = 'NO LIVE GIS (field)';
    banner = `UNMAPPED BLOCK [${ctx.chunkX}, ${ctx.chunkZ}]`;
    poiLabel = 'NO OSM';
    for (let gz = 0; gz < GRID_L; gz++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        if (ctx.surfaceGrid[idx(gx, gz)] === TILE.SIDEWALK) ctx.surfaceGrid[idx(gx, gz)] = TILE.FIELD;
      }
    }
  } else if (osm && osm.buildings.length === 0) {
    sourceTag = `OSM ROADS ONLY (${osm.roads.length}R)`;
  }

  const usedCadastral =
    isEmmettOrigin && ctx.chunkX === 0 && ctx.chunkZ === 0 && (!osm || osm.buildings.length < 3);
  if (osm && osm.roads.length > 0 && osm.buildings.length < 3 && !usedCadastral) {
    inferSparseLots(ctx, osm, rng, solid, glass, pins);
    if (osm.buildings.length === 0) {
      sourceTag = `OSM ROADS + INFERRED LOTS (${osm.roads.length}R)`;
    }
  }

  // Paint parking / toxic / park footprints from POI tags
  if (osm?.pois?.length) {
    for (const poi of osm.pois) {
      if (poi.poly && poi.poly.length >= 3) {
        let minX = GRID_W,
          maxX = 0,
          minZ = GRID_L,
          maxZ = 0;
        poi.poly.forEach(([px, pz]) => {
          minX = Math.min(minX, Math.floor(px));
          maxX = Math.max(maxX, Math.ceil(px));
          minZ = Math.min(minZ, Math.floor(pz));
          maxZ = Math.max(maxZ, Math.ceil(pz));
        });
        minX = Math.max(0, minX);
        maxX = Math.min(GRID_W - 1, maxX);
        minZ = Math.max(0, minZ);
        maxZ = Math.min(GRID_L - 1, maxZ);
        for (let gz = minZ; gz <= maxZ; gz++) {
          for (let gx = minX; gx <= maxX; gx++) {
            if (!pointInPolygon(gx + 0.5, gz + 0.5, poi.poly)) continue;
            const cIdx = idx(gx, gz);
            const cur = ctx.surfaceGrid[cIdx];
            if (cur === TILE.BUILDING || cur === TILE.WATER) continue;
            if (poi.kind === 'parking') ctx.surfaceGrid[cIdx] = TILE.PARKING;
            else if (poi.kind === 'toxic') ctx.surfaceGrid[cIdx] = TILE.TOXIC;
            else if (
              (poi.kind === 'park' || poi.kind === 'school') &&
              (cur === TILE.FIELD || cur === TILE.SIDEWALK)
            ) {
              ctx.surfaceGrid[cIdx] = TILE.FIELD;
            }
          }
        }
        if (poi.name && poi.kind !== 'addr') {
          const mid = poi.poly[Math.floor(poi.poly.length / 2)];
          const { wx, wz } = gridToWorld(mid[0], mid[1]);
          pins.push({ label: poi.name, wx, wy: 0.85, wz, type: 'poi' });
        }
      } else {
        const gx = Math.max(0, Math.min(GRID_W - 1, Math.floor(poi.gx)));
        const gz = Math.max(0, Math.min(GRID_L - 1, Math.floor(poi.gz)));
        const radius = poi.kind === 'fuel' || poi.kind === 'parking' ? 2 : poi.kind === 'toxic' ? 2 : 0;
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const tx = gx + dx;
            const tz = gz + dz;
            if (tx < 0 || tx >= GRID_W || tz < 0 || tz >= GRID_L) continue;
            const cIdx = idx(tx, tz);
            const cur = ctx.surfaceGrid[cIdx];
            if (cur === TILE.BUILDING || cur === TILE.WATER) continue;
            if (poi.kind === 'parking' || poi.kind === 'fuel') ctx.surfaceGrid[cIdx] = TILE.PARKING;
            else if (poi.kind === 'toxic') ctx.surfaceGrid[cIdx] = TILE.TOXIC;
          }
        }
        if (poi.name && poi.kind !== 'addr') {
          const { wx, wz } = gridToWorld(gx, gz);
          pins.push({
            label: poi.name,
            wx,
            wy: 0.85,
            wz,
            type: 'poi',
          });
        }
      }
    }
  }

  dressThinPlace(ctx, rng, props);
  props.push(paintGroundSheet(ctx.surfaceGrid));
  addRailsAndCurbs(ctx, solid);

  // Ruined cars — denser in urban / dense biomes via road density heuristic
  const roadCells = ctx.surfaceGrid.reduce((n, t) => n + (t === TILE.ROAD || t === TILE.PARKING ? 1 : 0), 0);
  const biome = (ctx.biomeHint || '').toUpperCase();
  const carTarget =
    biome === 'DENSE' ? 11 : biome === 'URBAN' ? 9 : roadCells > 900 ? 9 : roadCells > 450 ? 7 : 5;
  let cars = 0;
  for (let attempts = 0; attempts < 70 && cars < carTarget; attempts++) {
    const gx = 6 + Math.floor(rng() * (GRID_W - 12));
    const gz = 10 + Math.floor(rng() * (GRID_L - 20));
    const t = ctx.surfaceGrid[idx(gx, gz)];
    if (t !== TILE.ROAD && t !== TILE.SIDEWALK && t !== TILE.PARKING) continue;
    const { wx, wz } = gridToWorld(gx, gz);
    const car = buildRuinedCar();
    car.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });
    car.position.set(wx, 0, wz);
    car.rotation.y = rng() * Math.PI * 2;
    car.scale.setScalar(0.78 + rng() * 0.2);
    props.push(car);
    cars++;
  }

  // Street lamps along primary / wide roads
  let lamps = 0;
  const lampTarget = biome === 'DENSE' ? 14 : biome === 'URBAN' ? 10 : 6;
  for (let attempts = 0; attempts < 80 && lamps < lampTarget; attempts++) {
    const gx = 4 + Math.floor(rng() * (GRID_W - 8));
    const gz = 4 + Math.floor(rng() * (GRID_L - 8));
    if (ctx.surfaceGrid[idx(gx, gz)] !== TILE.SIDEWALK) continue;
    // Prefer sidewalks next to road
    const nearRoad =
      ctx.surfaceGrid[idx(gx - 1, gz)] === TILE.ROAD ||
      ctx.surfaceGrid[idx(gx + 1, gz)] === TILE.ROAD ||
      ctx.surfaceGrid[idx(gx, gz - 1)] === TILE.ROAD ||
      ctx.surfaceGrid[idx(gx, gz + 1)] === TILE.ROAD;
    if (!nearRoad) continue;
    if (((gx + gz) & 3) !== 0) continue;
    const { wx, wz } = gridToWorld(gx, gz);
    const lamp = buildStreetLamp();
    lamp.position.set(wx, 0, wz);
    lamp.rotation.y = rng() * Math.PI * 2;
    props.push(lamp);
    lamps++;
  }

  // Toxic barrels + scrap piles from POI / tile cues
  let barrels = 0;
  for (let attempts = 0; attempts < 50 && barrels < 6; attempts++) {
    const gx = 4 + Math.floor(rng() * (GRID_W - 8));
    const gz = 4 + Math.floor(rng() * (GRID_L - 8));
    if (ctx.surfaceGrid[idx(gx, gz)] !== TILE.TOXIC) continue;
    const { wx, wz } = gridToWorld(gx, gz);
    const barrel = buildToxicBarrel();
    barrel.position.set(wx, 0, wz);
    barrel.rotation.y = rng() * Math.PI;
    props.push(barrel);
    barrels++;
  }
  let scraps = 0;
  for (let attempts = 0; attempts < 40 && scraps < 5; attempts++) {
    const gx = 4 + Math.floor(rng() * (GRID_W - 8));
    const gz = 4 + Math.floor(rng() * (GRID_L - 8));
    const t = ctx.surfaceGrid[idx(gx, gz)];
    if (t !== TILE.SIDEWALK && t !== TILE.RUBBLE && t !== TILE.PARKING) continue;
    const { wx, wz } = gridToWorld(gx, gz);
    const pile = buildScrapPile();
    pile.position.set(wx, 0, wz);
    pile.rotation.y = rng() * Math.PI * 2;
    props.push(pile);
    scraps++;
  }

  return { solid, glass, pins, props, banner, poiLabel, sourceTag };
}

export function buildInstancedVoxels(
  solid: VoxelSpec[],
  glass: VoxelSpec[],
  group: THREE.Group,
): void {
  while (group.children.length) {
    const obj = group.children.pop()!;
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else (mat as THREE.Material | undefined)?.dispose();
      }
    });
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D();
  const tempColor = new THREE.Color();

  if (solid.length > 0) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.12 });
    const inst = new THREE.InstancedMesh(boxGeo, mat, solid.length);
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    for (let i = 0; i < solid.length; i++) {
      const v = solid[i];
      dummy.position.set(v.x, v.y, v.z);
      dummy.scale.set(v.sx, v.sy, v.sz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      tempColor.setHex(v.color);
      inst.setColorAt(i, tempColor);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }

  if (glass.length > 0) {
    const glassMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.88 });
    const glassInst = new THREE.InstancedMesh(boxGeo, glassMat, glass.length);
    for (let i = 0; i < glass.length; i++) {
      const v = glass[i];
      dummy.position.set(v.x, v.y, v.z);
      dummy.scale.set(v.sx, v.sy, v.sz);
      dummy.updateMatrix();
      glassInst.setMatrixAt(i, dummy.matrix);
      tempColor.setHex(v.color);
      glassInst.setColorAt(i, tempColor);
    }
    glassInst.instanceMatrix.needsUpdate = true;
    if (glassInst.instanceColor) glassInst.instanceColor.needsUpdate = true;
    group.add(glassInst);
  }
}

export function updateMapUnderlay(
  mesh: THREE.Mesh,
  curLat: number,
  curLon: number,
  bbox?: GeoBBox,
): void {
  // Canvas maps 1:1 onto the playable chunk bbox (same projection as OSM → grid)
  const zoom = 18;
  const nTiles = 2 ** zoom;
  const box = bbox ?? bboxFromCenter(curLat, curLon);
  const south = box.south;
  const north = box.north;
  const west = box.west;
  const east = box.east;

  const lonToTileX = (lon: number) => ((lon + 180) / 360) * nTiles;
  const latToTileY = (lat: number) => {
    const latRad = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * nTiles;
  };

  const x0 = lonToTileX(west);
  const x1 = lonToTileX(east);
  const y0 = latToTileY(north); // smaller tile Y at north
  const y1 = latToTileY(south);

  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = 512;
  mapCanvas.height = 1024;
  const ctx = mapCanvas.getContext('2d')!;
  const soil = ctx.createLinearGradient(0, 0, 512, 1024);
  soil.addColorStop(0, '#1a2414');
  soil.addColorStop(0.45, '#24301a');
  soil.addColorStop(1, '#1c2218');
  ctx.fillStyle = soil;
  ctx.fillRect(0, 0, 512, 1024);

  const tex = new THREE.CanvasTexture(mapCanvas);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = mesh.material as THREE.MeshBasicMaterial;
  if (mat.map) mat.map.dispose();
  mat.map = tex;
  mat.transparent = true;
  mat.opacity = 0.5;
  mat.needsUpdate = true;

  const tileXStart = Math.floor(x0);
  const tileXEnd = Math.floor(x1);
  const tileYStart = Math.floor(y0);
  const tileYEnd = Math.floor(y1);

  for (let ty = tileYStart; ty <= tileYEnd; ty++) {
    for (let tx = tileXStart; tx <= tileXEnd; tx++) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const left = ((tx - x0) / (x1 - x0)) * mapCanvas.width;
        const right = ((tx + 1 - x0) / (x1 - x0)) * mapCanvas.width;
        const top = ((ty - y0) / (y1 - y0)) * mapCanvas.height;
        const bottom = ((ty + 1 - y0) / (y1 - y0)) * mapCanvas.height;
        ctx.globalAlpha = 0.55;
        ctx.filter = 'contrast(0.95) saturate(0.5) brightness(0.52) sepia(0.12)';
        ctx.drawImage(img, left, top, right - left, bottom - top);
        tex.needsUpdate = true;
      };
      img.src = `https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/${zoom}/${tx}/${ty}.png`;
    }
  }
}

export { WORLD_W, WORLD_L, HALF_W, HALF_L };
