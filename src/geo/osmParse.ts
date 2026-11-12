import type {
  BuildingClass,
  OsmBuilding,
  OsmData,
  OsmLanduseKind,
  OsmPoiKind,
} from '../core/types';
import { bboxFromCenter, latLonToGrid, metersToCells, type GeoBBox } from './projection';

type OsmEl = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
  members?: Array<{
    type: string;
    ref: number;
    role: string;
    geometry?: Array<{ lat: number; lon: number }>;
    lat?: number;
    lon?: number;
  }>;
};

function parseLevels(tags: Record<string, string>, buildingClass: BuildingClass): number {
  if (tags['building:levels']) {
    const n = parseInt(tags['building:levels'], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (tags.height) {
    const h = parseFloat(tags.height);
    if (Number.isFinite(h) && h > 0) return Math.max(1, Math.round(h / 3));
  }
  const b = (tags.building || '').toLowerCase();
  if (b === 'house' || b === 'detached' || b === 'bungalow' || b === 'hut' || b === 'cabin' || b === 'terrace') {
    return 1;
  }
  if (buildingClass === 'apartments') return 5;
  if (buildingClass === 'garage') return 1;
  if (buildingClass === 'industrial') return 2;
  if (buildingClass === 'church' || buildingClass === 'school') return 2;
  if (buildingClass === 'retail') return 2;
  return 2;
}

function buildingClassFromTags(tags: Record<string, string>): BuildingClass {
  const b = (tags.building || '').toLowerCase();
  const amenity = tags.amenity || '';
  if (b === 'church' || b === 'chapel' || b === 'cathedral' || amenity === 'place_of_worship') return 'church';
  if (b === 'garage' || b === 'garages' || b === 'carport') return 'garage';
  if (b === 'apartments') return 'apartments';
  if (b === 'yes' && tags['building:levels'] && parseInt(tags['building:levels'], 10) >= 4) {
    return 'apartments';
  }
  if (b === 'house' || b === 'detached' || b === 'bungalow' || b === 'terrace' || b === 'semidetached_house') {
    return 'garage';
  }
  if (b === 'retail' || b === 'commercial' || b === 'supermarket' || tags.shop) return 'retail';
  if (b === 'industrial' || b === 'warehouse' || b === 'shed' || b === 'barn') return 'industrial';
  if (b === 'school' || amenity === 'school' || amenity === 'university') return 'school';
  if (amenity === 'place_of_worship') return 'church';
  return 'generic';
}

function parseOsmColour(raw?: string): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase();
  if (s.startsWith('#') && (s.length === 7 || s.length === 4)) {
    const hex =
      s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
    const n = parseInt(hex.slice(1), 16);
    return Number.isFinite(n) ? n : undefined;
  }
  const named: Record<string, number> = {
    red: 0x991b1b,
    brown: 0x7c2d12,
    white: 0xd6d3d1,
    grey: 0x64748b,
    gray: 0x64748b,
    black: 0x27272a,
    yellow: 0xb45309,
    beige: 0xa8a29e,
    tan: 0xa16207,
    green: 0x3f6212,
    blue: 0x1e3a5f,
    orange: 0xc2410c,
    brick: 0x9a3412,
    maroon: 0x7f1d1d,
  };
  return named[s];
}

function closePt(a: [number, number], b: [number, number], eps = 0.55): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < eps;
}

/** Join split multipolygon ways that share endpoints into closed rings. */
function stitchWays(parts: [number, number][][]): [number, number][][] {
  const unused = parts.filter((p) => p.length >= 2).map((p) => p.slice());
  const rings: [number, number][][] = [];
  while (unused.length) {
    let ring = unused.pop()!;
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = unused.length - 1; i >= 0; i--) {
        const p = unused[i];
        const rs = ring[0];
        const re = ring[ring.length - 1];
        const ps = p[0];
        const pe = p[p.length - 1];
        if (closePt(re, ps)) {
          ring = ring.concat(p.slice(1));
          unused.splice(i, 1);
          changed = true;
        } else if (closePt(re, pe)) {
          ring = ring.concat(p.slice(0, -1).reverse());
          unused.splice(i, 1);
          changed = true;
        } else if (closePt(rs, pe)) {
          ring = p.slice(0, -1).concat(ring);
          unused.splice(i, 1);
          changed = true;
        } else if (closePt(rs, ps)) {
          ring = p.slice().reverse().slice(0, -1).concat(ring);
          unused.splice(i, 1);
          changed = true;
        }
      }
    }
    rings.push(ring);
  }
  return rings;
}

function poiKindFromTags(tags: Record<string, string>): OsmPoiKind | null {
  const amenity = tags.amenity || '';
  const b = (tags.building || '').toLowerCase();
  if (b === 'church' || b === 'chapel' || b === 'cathedral') return 'worship';
  if (amenity === 'fuel') return 'fuel';
  if (
    amenity === 'parking' ||
    tags.amenity === 'parking_space' ||
    (tags.highway === 'service' && tags.service === 'parking_aisle')
  ) {
    return 'parking';
  }
  if (amenity === 'school' || amenity === 'university' || amenity === 'kindergarten') return 'school';
  if (amenity === 'place_of_worship') return 'worship';
  if (amenity === 'cafe' || amenity === 'restaurant' || amenity === 'fast_food' || amenity === 'bar') return 'cafe';
  if (amenity === 'hospital' || amenity === 'clinic' || amenity === 'doctors') return 'hospital';
  if (tags.shop) return 'shop';
  if (tags.leisure === 'park' || tags.leisure === 'pitch' || tags.leisure === 'playground' || tags.landuse === 'grass') {
    return 'park';
  }
  if (tags.landuse === 'industrial' || tags.landuse === 'brownfield' || tags.hazard || tags.landuse === 'quarry') {
    return 'toxic';
  }
  return null;
}

function landuseKind(tags: Record<string, string>): OsmLanduseKind | null {
  const lu = tags.landuse || '';
  if (lu === 'residential' || lu === 'grass' || lu === 'meadow' || lu === 'farmland' || lu === 'farmyard') return 'residential';
  if (lu === 'forest' || lu === 'wood' || tags.natural === 'wood') return 'forest';
  if (lu === 'commercial' || lu === 'retail') return 'commercial';
  if (lu === 'industrial' || lu === 'brownfield' || lu === 'quarry') return 'industrial';
  if (tags.leisure === 'park' || tags.leisure === 'pitch' || tags.leisure === 'playground' || amenitySchool(tags)) {
    return 'park';
  }
  return null;
}

function amenitySchool(tags: Record<string, string>): boolean {
  return tags.amenity === 'school' || tags.amenity === 'university' || tags.amenity === 'kindergarten';
}

function roadHalfWidthCells(tags: Record<string, string>, hwy: string): number {
  if (tags.width) {
    const w = parseFloat(tags.width);
    if (Number.isFinite(w) && w > 0) return Math.max(0.8, metersToCells(w) / 2);
  }
  if (tags.lanes) {
    const lanes = parseFloat(tags.lanes);
    if (Number.isFinite(lanes) && lanes > 0) return Math.max(0.9, metersToCells(lanes * 3.5) / 2);
  }
  if (['footway', 'path', 'steps', 'pedestrian', 'cycleway'].includes(hwy)) return metersToCells(1.6) / 2;
  if (hwy === 'service' || hwy === 'driveway' || hwy === 'alley') return metersToCells(4.5) / 2;
  if (['primary', 'secondary', 'trunk', 'motorway', 'motorway_link'].includes(hwy)) return metersToCells(11) / 2;
  if (['tertiary', 'residential', 'unclassified', 'living_street'].includes(hwy)) return metersToCells(7.5) / 2;
  return metersToCells(6) / 2;
}

function ptsFromGeom(geom: Array<{ lat: number; lon: number }> | undefined, bbox: GeoBBox): [number, number][] {
  if (!geom || geom.length < 2) return [];
  return geom.map((g) => latLonToGrid(g.lat, g.lon, bbox));
}

function centroid(pts: [number, number][]): [number, number] {
  const mid = pts[Math.floor(pts.length / 2)];
  return mid;
}

export function parseOverpassJson(
  data: { elements?: unknown[] },
  curLat: number,
  curLon: number,
  bbox: GeoBBox = bboxFromCenter(curLat, curLon),
): OsmData | null {
  const elements = (data.elements || []) as OsmEl[];

  const nodes = new Map<number, [number, number]>();
  const nodeTags = new Map<number, Record<string, string>>();
  for (const el of elements) {
    if (el.type === 'node' && el.lat != null && el.lon != null) {
      nodes.set(el.id, latLonToGrid(el.lat, el.lon, bbox));
      if (el.tags) nodeTags.set(el.id, el.tags);
    }
  }

  const ways = new Map<number, { pts: [number, number][]; tags: Record<string, string> }>();
  for (const el of elements) {
    if (el.type !== 'way') continue;
    let pts = ptsFromGeom(el.geometry, bbox);
    if (pts.length < 2 && el.nodes) {
      pts = el.nodes.map((id) => nodes.get(id)).filter(Boolean) as [number, number][];
    }
    if (pts.length < 2) continue;
    ways.set(el.id, { pts, tags: el.tags || {} });
  }

  const relationBuildingWays = new Set<number>();
  for (const el of elements) {
    if (el.type !== 'relation' || !el.members) continue;
    const tags = el.tags || {};
    if (!tags.building && !(tags.type === 'multipolygon' && tags.building)) continue;
    for (const m of el.members) {
      if (m.type === 'way') relationBuildingWays.add(m.ref);
    }
  }

  const parsed: OsmData = {
    roads: [],
    buildings: [],
    railways: [],
    waterways: [],
    streetNames: [],
    pois: [],
    landuse: [],
  };

  const pushBuilding = (pts: [number, number][], tags: Record<string, string>, inners?: [number, number][][]) => {
    if (pts.length < 3) return;
    const buildingClass = buildingClassFromTags(tags);
    const colour = parseOsmColour(tags['building:colour'] || tags.colour);
    parsed.buildings.push({
      poly: pts,
      inners: inners && inners.length ? inners : undefined,
      levels: parseLevels(tags, buildingClass),
      name: tags.name || tags['addr:housename'] || '',
      buildingClass,
      housenumber: tags['addr:housenumber'],
      colour,
    });
  };

  const pushPoi = (kind: OsmPoiKind, gx: number, gz: number, name: string, poly?: [number, number][]) => {
    parsed.pois.push({ kind, gx, gz, name, poly });
  };

  const namedHighways: { name: string; halfWidth: number }[] = [];

  for (const [wayId, way] of ways) {
    const { pts, tags } = way;

    if (tags.building) {
      if (!relationBuildingWays.has(wayId)) pushBuilding(pts, tags);
      continue;
    }

    const lu = landuseKind(tags);
    if (lu && pts.length >= 3) {
      parsed.landuse.push({ kind: lu, poly: pts, name: tags.name || lu });
    }

    const poiKind = poiKindFromTags(tags);
    if (poiKind) {
      const mid = centroid(pts);
      pushPoi(poiKind, mid[0], mid[1], tags.name || poiKind, pts.length >= 3 ? pts : undefined);
    }

    if (tags.highway) {
      const hwy = tags.highway;
      const footpath = ['footway', 'path', 'steps', 'pedestrian', 'cycleway'].includes(hwy);
      const isPrimary = ['primary', 'secondary', 'trunk', 'motorway', 'motorway_link'].includes(hwy);
      const halfWidth = roadHalfWidthCells(tags, hwy);
      const name = tags.name || tags.ref || '';
      parsed.roads.push({
        points: pts,
        halfWidth,
        name,
        primary: isPrimary,
        footpath,
      });
      if (name && !footpath) namedHighways.push({ name, halfWidth });
    } else if (tags.railway && tags.railway !== 'abandoned') {
      parsed.railways.push({ points: pts, name: tags.name || 'Railroad' });
    } else if (tags.waterway || tags.natural === 'water' || tags.landuse === 'basin') {
      parsed.waterways.push({ points: pts });
    }
  }

  for (const el of elements) {
    if (el.type !== 'relation' || !el.members) continue;
    const tags = el.tags || {};
    const isBuilding = !!tags.building || (tags.type === 'multipolygon' && !!tags.building);
    const isWater = tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'basin';
    const lu = landuseKind(tags);
    if (!isBuilding && !isWater && !lu && !poiKindFromTags(tags)) continue;

    const outers: [number, number][][] = [];
    const inners: [number, number][][] = [];
    for (const m of el.members) {
      if (m.type !== 'way') continue;
      let pts: [number, number][] = [];
      if (m.geometry && m.geometry.length >= 2) pts = ptsFromGeom(m.geometry, bbox);
      else {
        const way = ways.get(m.ref);
        if (way) pts = way.pts;
      }
      if (pts.length < 2) continue;
      if (m.role === 'inner') inners.push(pts);
      else outers.push(pts);
    }
    if (outers.length === 0) continue;

    const stitchedOuters = stitchWays(outers);
    const stitchedInners = stitchWays(inners);
    for (const ring of stitchedOuters) {
      if (isBuilding) pushBuilding(ring, tags, stitchedInners);
      if (isWater) parsed.waterways.push({ points: ring });
      if (lu && ring.length >= 3) parsed.landuse.push({ kind: lu, poly: ring, name: tags.name || lu });
      const pk = poiKindFromTags(tags);
      if (pk) {
        const mid = centroid(ring);
        pushPoi(pk, mid[0], mid[1], tags.name || pk, ring);
      }
    }
  }

  for (const [id, tags] of nodeTags) {
    const pt = nodes.get(id);
    if (!pt) continue;
    const kind = poiKindFromTags(tags);
    if (kind) pushPoi(kind, pt[0], pt[1], tags.name || kind);
    if (tags['addr:housenumber'] && !tags.building) {
      parsed.pois.push({
        kind: 'addr',
        gx: pt[0],
        gz: pt[1],
        name: tags['addr:housenumber'],
      });
    }
  }

  // Housenumbers as empty-name skip — store via building housenumber; node addrs become tiny pins in voxelizer via pois named like numbers
  const ranked = namedHighways.sort((a, b) => b.halfWidth - a.halfWidth);
  const seen = new Set<string>();
  for (const r of ranked) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    parsed.streetNames.push(r.name);
    if (parsed.streetNames.length >= 2) break;
  }

  const total =
    parsed.buildings.length +
    parsed.roads.length +
    parsed.railways.length +
    parsed.pois.length +
    parsed.landuse.length;
  return total > 0 ? parsed : null;
}

export function chunkBBox(curLat: number, curLon: number) {
  const b = bboxFromCenter(curLat, curLon);
  return { s: b.south, n: b.north, w: b.west, e: b.east };
}
