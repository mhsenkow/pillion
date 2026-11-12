import type { BuildingClass, OsmData } from '../core/types';
import { EMMETT_GIS } from './emmettGis';

/**
 * Vector OSM-shaped snapshot of the Emmett home chunk, derived from the
 * verified cadastral. Used when Overpass is unreachable so the radar still
 * shows real street geometry instead of an empty / synthetic grid.
 */
export function emmettOsmFallback(): OsmData {
  return {
    roads: EMMETT_GIS.roads.map((r) => ({
      points: r.points,
      halfWidth: r.halfWidth,
      name: r.name,
      primary: r.primary,
    })),
    buildings: EMMETT_GIS.buildings.map((b) => ({
      poly: [
        [b.x0, b.z0],
        [b.x1, b.z0],
        [b.x1, b.z1],
        [b.x0, b.z1],
        [b.x0, b.z0],
      ] as [number, number][],
      levels: Math.max(1, Math.round(b.height / 6)),
      name: b.name,
      buildingClass: (b.steeple
        ? 'church'
        : b.silo
          ? 'industrial'
          : b.convenience
            ? 'retail'
            : 'generic') as BuildingClass,
    })),
    railways: EMMETT_GIS.railways.map((r) => ({
      points: r.points,
      name: r.name,
    })),
    waterways: [],
    streetNames: [
      ...EMMETT_GIS.roads.map((r) => r.name),
      ...EMMETT_GIS.railways.map((r) => r.name),
    ],
    pois: [
      { kind: 'fuel', gx: 22, gz: 48, name: 'Emmett Fuel Cache' },
      { kind: 'shop', gx: 41, gz: 72, name: 'Scrap Mercantile' },
      { kind: 'park', gx: 58, gz: 110, name: 'Quiet Green' },
      {
        kind: 'parking',
        gx: 34,
        gz: 64,
        name: 'Lot B',
        poly: [
          [30, 60],
          [38, 60],
          [38, 70],
          [30, 70],
          [30, 60],
        ],
      },
      {
        kind: 'toxic',
        gx: 12,
        gz: 130,
        name: 'Ash Sump',
        poly: [
          [8, 126],
          [16, 126],
          [16, 136],
          [8, 136],
          [8, 126],
        ],
      },
    ],
    landuse: [],
  };
}

export function isNearEmmett(lat: number, lon: number): boolean {
  return Math.abs(lat - EMMETT_GIS.lat) < 0.006 && Math.abs(lon - EMMETT_GIS.lon) < 0.006;
}
