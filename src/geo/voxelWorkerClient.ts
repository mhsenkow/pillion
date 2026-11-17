import type { OsmBuilding } from '../core/types';
import {
  computeBuildingHeights,
  rasterizeBuildingFootprints,
  type BuildingHeightResult,
  type RasterCell,
  type WorkerBuildingInput,
} from './voxelWorkerCore';

export type { BuildingHeightResult, RasterCell, WorkerBuildingInput };

function osmToWorkerBuildings(buildings: OsmBuilding[]): WorkerBuildingInput[] {
  return buildings.map((b, i) => ({
    id: i,
    poly: b.poly,
    tags: {
      building: b.buildingClass === 'generic' ? 'yes' : b.buildingClass,
      'building:levels': String(b.levels),
    },
  }));
}

function osmPolygonsFromTags(
  polygons: Array<{ id: number; poly: [number, number][]; tags: Record<string, string> }>,
): WorkerBuildingInput[] {
  return polygons.map((p) => ({ id: p.id, poly: p.poly, tags: p.tags }));
}

export interface VoxelWorkerClientResult {
  heights: BuildingHeightResult[];
  cells: RasterCell[];
  usedWorker: boolean;
}

export class VoxelWorkerClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<
    number,
  { resolve: (v: { heights?: BuildingHeightResult[]; cells?: RasterCell[] }) => void; reject: (e: Error) => void }
  >();

  constructor() {
    if (typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./voxelWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev) => {
        const data = ev.data as {
          id: number;
          ok: boolean;
          heights?: BuildingHeightResult[];
          cells?: RasterCell[];
          error?: string;
        };
        const p = this.pending.get(data.id);
        if (!p) return;
        this.pending.delete(data.id);
        if (!data.ok) {
          p.reject(new Error(data.error || 'voxel_worker_failed'));
          return;
        }
        p.resolve({ heights: data.heights, cells: data.cells });
      };
      this.worker.onerror = () => {
        this.worker?.terminate();
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }

  private run<T extends 'building-heights' | 'rasterize'>(
    kind: T,
    buildings: WorkerBuildingInput[],
    grid?: { w: number; l: number },
  ): Promise<{ heights?: BuildingHeightResult[]; cells?: RasterCell[] }> {
    if (!this.worker) {
      return Promise.resolve({
        heights: kind === 'building-heights' ? computeBuildingHeights(buildings) : undefined,
        cells:
          kind === 'rasterize'
            ? rasterizeBuildingFootprints(buildings, grid?.w, grid?.l)
            : undefined,
      });
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg =
        kind === 'building-heights'
          ? { id, kind: 'building-heights' as const, buildings }
          : {
              id,
              kind: 'rasterize' as const,
              buildings,
              gridW: grid?.w,
              gridL: grid?.l,
            };
      this.worker!.postMessage(msg);
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        resolve({
          heights: kind === 'building-heights' ? computeBuildingHeights(buildings) : undefined,
          cells:
            kind === 'rasterize'
              ? rasterizeBuildingFootprints(buildings, grid?.w, grid?.l)
              : undefined,
        });
      }, 8000);
    });
  }

  async processOsmBuildings(
    buildings: OsmBuilding[],
    opts: { rasterize?: boolean; gridW?: number; gridL?: number } = {},
  ): Promise<VoxelWorkerClientResult> {
    const inputs = osmToWorkerBuildings(buildings);
    const heights = await this.run('building-heights', inputs);
    let cells: RasterCell[] = [];
    if (opts.rasterize !== false) {
      const grid =
        opts.gridW !== undefined && opts.gridL !== undefined
          ? { w: opts.gridW, l: opts.gridL }
          : undefined;
      const raster = await this.run('rasterize', inputs, grid);
      cells = raster.cells ?? [];
    }
    return {
      heights: heights.heights ?? computeBuildingHeights(inputs),
      cells,
      usedWorker: this.worker !== null,
    };
  }

  async processTaggedPolygons(
    polygons: Array<{ id: number; poly: [number, number][]; tags: Record<string, string> }>,
  ): Promise<VoxelWorkerClientResult> {
    const inputs = osmPolygonsFromTags(polygons);
    const [heights, raster] = await Promise.all([
      this.run('building-heights', inputs),
      this.run('rasterize', inputs),
    ]);
    return {
      heights: heights.heights ?? computeBuildingHeights(inputs),
      cells: raster.cells ?? rasterizeBuildingFootprints(inputs),
      usedWorker: this.worker !== null,
    };
  }

  /** Synchronous fallback when workers are unavailable (SSR, tests). */
  static processSync(buildings: WorkerBuildingInput[]): {
    heights: BuildingHeightResult[];
    cells: RasterCell[];
  } {
    return {
      heights: computeBuildingHeights(buildings),
      cells: rasterizeBuildingFootprints(buildings),
    };
  }
}