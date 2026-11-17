import { GRID_L, GRID_W } from '../core/constants';

export interface WorkerBuildingInput {
  id: number;
  poly: [number, number][];
  tags: Record<string, string>;
}

export interface BuildingHeightResult {
  id: number;
  levels: number;
  heightMeters: number;
}

export interface RasterCell {
  gx: number;
  gz: number;
  buildingId: number;
  levels: number;
}

export function parseHeightFromTags(tags: Record<string, string>): { levels: number; heightMeters: number } {
  if (tags['building:levels']) {
    const n = parseInt(tags['building:levels'], 10);
    if (Number.isFinite(n) && n > 0) {
      return { levels: n, heightMeters: n * 3 };
    }
  }
  if (tags.height) {
    const raw = String(tags.height).replace(/m$/i, '').trim();
    const h = parseFloat(raw);
    if (Number.isFinite(h) && h > 0) {
      return { levels: Math.max(1, Math.round(h / 3)), heightMeters: h };
    }
  }
  const b = (tags.building || '').toLowerCase();
  if (b === 'house' || b === 'detached' || b === 'bungalow' || b === 'hut') {
    return { levels: 1, heightMeters: 3 };
  }
  if (b === 'apartments' || b === 'commercial' || b === 'retail') {
    return { levels: 4, heightMeters: 12 };
  }
  if (b === 'church' || b === 'cathedral' || b === 'chapel') {
    return { levels: 2, heightMeters: 8 };
  }
  if (b === 'industrial' || b === 'warehouse') {
    return { levels: 2, heightMeters: 7 };
  }
  return { levels: 2, heightMeters: 6 };
}

export function computeBuildingHeights(buildings: WorkerBuildingInput[]): BuildingHeightResult[] {
  return buildings.map((b) => {
    const { levels, heightMeters } = parseHeightFromTags(b.tags);
    return { id: b.id, levels, heightMeters };
  });
}

function pointInPolygon(px: number, pz: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersect =
      zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi || 1e-7) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Footprint raster: one cell list per building (later cells win on overlap). */
export function rasterizeBuildingFootprints(
  buildings: WorkerBuildingInput[],
  gridW = GRID_W,
  gridL = GRID_L,
): RasterCell[] {
  const cells: RasterCell[] = [];
  for (const b of buildings) {
    if (b.poly.length < 3) continue;
    const { levels } = parseHeightFromTags(b.tags);
    let minX = gridW,
      maxX = 0,
      minZ = gridL,
      maxZ = 0;
    for (const [px, pz] of b.poly) {
      minX = Math.min(minX, Math.floor(px));
      maxX = Math.max(maxX, Math.ceil(px));
      minZ = Math.min(minZ, Math.floor(pz));
      maxZ = Math.max(maxZ, Math.ceil(pz));
    }
    minX = Math.max(0, minX);
    maxX = Math.min(gridW - 1, maxX);
    minZ = Math.max(0, minZ);
    maxZ = Math.min(gridL - 1, maxZ);
    for (let gz = minZ; gz <= maxZ; gz++) {
      for (let gx = minX; gx <= maxX; gx++) {
        if (!pointInPolygon(gx + 0.5, gz + 0.5, b.poly)) continue;
        cells.push({ gx, gz, buildingId: b.id, levels });
      }
    }
  }
  return cells;
}

export type VoxelWorkerRequest =
  | { id: number; kind: 'building-heights'; buildings: WorkerBuildingInput[] }
  | {
      id: number;
      kind: 'rasterize';
      buildings: WorkerBuildingInput[];
      gridW?: number;
      gridL?: number;
    };

export type VoxelWorkerResponse = {
  id: number;
  ok: boolean;
  heights?: BuildingHeightResult[];
  cells?: RasterCell[];
  error?: string;
};

export function handleVoxelWorkerRequest(msg: VoxelWorkerRequest): VoxelWorkerResponse {
  try {
    if (msg.kind === 'building-heights') {
      return { id: msg.id, ok: true, heights: computeBuildingHeights(msg.buildings) };
    }
    const gw = msg.gridW ?? GRID_W;
    const gl = msg.gridL ?? GRID_L;
    return {
      id: msg.id,
      ok: true,
      cells: rasterizeBuildingFootprints(msg.buildings, gw, gl),
    };
  } catch (e) {
    return { id: msg.id, ok: false, error: String(e) };
  }
}