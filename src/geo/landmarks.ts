import type { OsmData } from '../core/types';

export type LandmarkKind = 'water_tower' | 'church' | 'stadium';

export interface LandmarkHit {
  kind: LandmarkKind;
  name: string;
  lat?: number;
  lon?: number;
  gx?: number;
  gz?: number;
  osmId?: number;
  tags: Record<string, string>;
}

const WATER_TOWER = new Set(['water_tower', 'tower']);
const STADIUM_AMENITY = new Set(['stadium', 'arena']);
const STADIUM_LEISURE = new Set(['stadium', 'sports_centre']);
const WORSHIP = new Set(['place_of_worship', 'church', 'cathedral', 'chapel']);

/** Classify a single OSM element tag set. */
export function detectLandmarkFromTags(tags: Record<string, string>): LandmarkKind | null {
  const manMade = (tags.man_made || '').toLowerCase();
  if (manMade === 'water_tower') return 'water_tower';
  if (manMade === 'tower' && (tags.content === 'water' || tags.tower_type === 'water')) {
    return 'water_tower';
  }
  if (tags['tower:type'] === 'water' || tags['tower:type'] === 'water_tower') {
    return 'water_tower';
  }

  const building = (tags.building || '').toLowerCase();
  const amenity = (tags.amenity || '').toLowerCase();
  const religion = tags.religion;
  if (
    building === 'church' ||
    building === 'cathedral' ||
    building === 'chapel' ||
    amenity === 'place_of_worship' ||
    WORSHIP.has(amenity)
  ) {
    if (religion === 'none') return null;
    return 'church';
  }

  const leisure = (tags.leisure || '').toLowerCase();
  if (STADIUM_AMENITY.has(amenity) || STADIUM_LEISURE.has(leisure)) {
    return 'stadium';
  }
  if (building === 'stadium' || tags.sport) {
    if (tags.sport && leisure !== 'pitch') return 'stadium';
    if (building === 'stadium') return 'stadium';
  }

  if (manMade && WATER_TOWER.has(manMade) && tags.substance === 'water') {
    return 'water_tower';
  }

  return null;
}

function landmarkName(tags: Record<string, string>, kind: LandmarkKind): string {
  const explicit = tags.name || tags['addr:housename'];
  if (explicit) return explicit;
  if (kind === 'water_tower') return 'Water tower';
  if (kind === 'church') return tags.denomination ? `${tags.denomination} church` : 'Church';
  return tags.sport ? `${tags.sport} stadium` : 'Stadium';
}

/** Scan raw Overpass elements before full parse (dev / worker tooling). */
export function detectLandmarksInElements(
  elements: Array<{
    type: string;
    id: number;
    lat?: number;
    lon?: number;
    tags?: Record<string, string>;
  }>,
): LandmarkHit[] {
  const hits: LandmarkHit[] = [];
  for (const el of elements) {
    const tags = el.tags;
    if (!tags) continue;
    const kind = detectLandmarkFromTags(tags);
    if (!kind) continue;
    hits.push({
      kind,
      name: landmarkName(tags, kind),
      lat: el.lat,
      lon: el.lon,
      osmId: el.id,
      tags,
    });
  }
  return hits;
}

/** Heuristic pass on parsed chunk OSM (buildings + POIs). */
export function detectLandmarksInOsmData(osm: OsmData): LandmarkHit[] {
  const hits: LandmarkHit[] = [];
  for (const b of osm.buildings) {
    const pseudo: Record<string, string> = {
      building: b.buildingClass === 'church' ? 'church' : b.buildingClass,
      name: b.name,
    };
    if (b.buildingClass === 'church') {
      hits.push({
        kind: 'church',
        name: b.name || 'Church',
        tags: pseudo,
      });
    }
  }
  for (const p of osm.pois ?? []) {
    if (p.kind === 'worship') {
      hits.push({
        kind: 'church',
        name: p.name || 'Church',
        gx: p.gx,
        gz: p.gz,
        tags: { amenity: 'place_of_worship', name: p.name },
      });
    }
  }
  return hits;
}