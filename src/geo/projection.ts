import { CELL_METERS, CHUNK_METERS_L, CHUNK_METERS_W, GRID_L, GRID_W, QUERY_PAD_METERS } from '../core/constants';

const METERS_PER_DEG_LAT = 111_320;

export interface GeoBBox {
  south: number;
  north: number;
  west: number;
  east: number;
  curLat: number;
  curLon: number;
}

export function metersPerDegLon(lat: number): number {
  return METERS_PER_DEG_LAT * Math.max(0.12, Math.cos((lat * Math.PI) / 180));
}

function mercatorY(lat: number): number {
  const latRad = (lat * Math.PI) / 180;
  const s = Math.min(Math.PI / 2 - 1e-6, Math.max(-Math.PI / 2 + 1e-6, latRad));
  return Math.log(Math.tan(Math.PI / 4 + s / 2));
}

/** Meter-true chunk rectangle in a local tangent frame around the drop origin. */
export function chunkBBoxFromOrigin(
  originLat: number,
  originLon: number,
  chunkX: number,
  chunkZ: number,
): GeoBBox {
  const eastM = chunkX * CHUNK_METERS_W;
  const southM = chunkZ * CHUNK_METERS_L;
  const curLat = originLat - southM / METERS_PER_DEG_LAT;
  const curLon = originLon + eastM / metersPerDegLon(originLat);
  return bboxFromCenter(curLat, curLon, originLat);
}

/** Playable bbox centered on a lat/lon. `lonRefLat` keeps E–W degree width tessellating with the origin. */
export function bboxFromCenter(curLat: number, curLon: number, lonRefLat = curLat): GeoBBox {
  const halfLat = CHUNK_METERS_L / 2 / METERS_PER_DEG_LAT;
  const halfLon = CHUNK_METERS_W / 2 / metersPerDegLon(lonRefLat);
  return {
    south: curLat - halfLat,
    north: curLat + halfLat,
    west: curLon - halfLon,
    east: curLon + halfLon,
    curLat,
    curLon,
  };
}

export function padBBox(bbox: GeoBBox, padMeters = QUERY_PAD_METERS): GeoBBox {
  const padLat = padMeters / METERS_PER_DEG_LAT;
  const padLon = padMeters / metersPerDegLon(bbox.curLat);
  return {
    south: bbox.south - padLat,
    north: bbox.north + padLat,
    west: bbox.west - padLon,
    east: bbox.east + padLon,
    curLat: bbox.curLat,
    curLon: bbox.curLon,
  };
}

/** Mercator-consistent node → grid (matches Carto underlay mapping). */
export function latLonToGrid(lat: number, lon: number, bbox: GeoBBox): [number, number] {
  const gx = ((lon - bbox.west) / (bbox.east - bbox.west)) * GRID_W;
  const my = mercatorY(lat);
  const mSouth = mercatorY(bbox.south);
  const mNorth = mercatorY(bbox.north);
  const gz = ((mNorth - my) / (mNorth - mSouth)) * GRID_L;
  return [gx, gz];
}

export function gridToLatLon(gx: number, gz: number, bbox: GeoBBox): { lat: number; lon: number } {
  const lon = bbox.west + (gx / GRID_W) * (bbox.east - bbox.west);
  const t = gz / GRID_L;
  const mSouth = mercatorY(bbox.south);
  const mNorth = mercatorY(bbox.north);
  const my = mNorth - t * (mNorth - mSouth);
  const lat = (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * (180 / Math.PI);
  return { lat, lon };
}

export function metersToCells(meters: number): number {
  return meters / CELL_METERS;
}

export function scaleReadout(): string {
  return `${CELL_METERS.toFixed(1)}m/cell · ${Math.round(CHUNK_METERS_W)}×${Math.round(CHUNK_METERS_L)}m`;
}

export function bboxKey(bbox: GeoBBox): string {
  const q = (n: number) => n.toFixed(5);
  return `${q(bbox.south)}_${q(bbox.west)}_${q(bbox.north)}_${q(bbox.east)}`;
}
