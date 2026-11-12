import type { OsmData } from '../core/types';
import { parseOverpassJson } from './osmParse';
import { buildOverpassQueryFromBBox } from './overpassQuery';
import { bboxFromCenter, padBBox, type GeoBBox } from './projection';

const DIRECT_MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const NOMINATIM_UA = {
  Accept: 'application/json',
  'User-Agent': 'pillion.ibm.io/1.0 (gridfall diorama; contact: local-dev)',
};

async function tryParse(res: Response, lat: number, lon: number, bbox: GeoBBox): Promise<OsmData | null> {
  if (!res.ok) return null;
  const data = await res.json();
  return parseOverpassJson(data, lat, lon, bbox);
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function osmApiUrl(bbox: GeoBBox): string {
  const p = padBBox(bbox);
  return `/api/osm?lat=${bbox.curLat}&lon=${bbox.curLon}&s=${p.south}&w=${p.west}&n=${p.north}&e=${p.east}`;
}

/** Prefer same-origin Cloudflare proxy, then direct Overpass mirrors. */
export async function fetchOsmChunk(
  curLat: number,
  curLon: number,
  bbox: GeoBBox = bboxFromCenter(curLat, curLon),
): Promise<OsmData | null> {
  try {
    const res = await fetchWithTimeout(osmApiUrl(bbox), { headers: { Accept: 'application/json' } }, 8000);
    if (res.ok) {
      const data = await res.json();
      if (!data.error) {
        const parsed = parseOverpassJson(data, curLat, curLon, bbox);
        if (parsed) return parsed;
      }
    }
  } catch {
    /* fall through */
  }

  const query = buildOverpassQueryFromBBox(padBBox(bbox));
  for (const url of DIRECT_MIRRORS) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          body: new URLSearchParams({ data: query }),
          headers: { 'User-Agent': 'pillion.ibm.io/1.0 (gridfall diorama; local-dev)' },
        },
        20000,
      );
      const parsed = await tryParse(res, curLat, curLon, bbox);
      if (parsed) return parsed;
    } catch {
      /* next */
    }
  }
  return null;
}

function formatNominatimName(hit: {
  display_name?: string;
  address?: Record<string, string>;
  name?: string;
}): string {
  const a = hit.address || {};
  const road = a.road || a.pedestrian;
  const suburb = a.neighbourhood || a.suburb || a.hamlet;
  const city = a.village || a.town || a.city || a.municipality;
  const bits = [road, suburb, city].filter(Boolean);
  if (bits.length >= 2) return bits.join(', ');
  if (bits.length === 1 && (a.state || a.country)) return `${bits[0]}, ${a.state || a.country}`;
  if (hit.name) return hit.name;
  return (hit.display_name || 'Drop').split(',').slice(0, 3).join(',').trim();
}

export async function searchNominatim(q: string): Promise<{ lat: number; lon: number; name: string } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(q)}`,
      { headers: NOMINATIM_UA },
    );
    const arr = await res.json();
    if (arr?.length > 0) {
      return {
        lat: parseFloat(arr[0].lat),
        lon: parseFloat(arr[0].lon),
        name: formatNominatimName(arr[0]),
      };
    }
  } catch {
    /* offline */
  }
  return null;
}

export function parseLatLonQuery(search = typeof window !== 'undefined' ? window.location.search : ''): {
  lat: number;
  lon: number;
} | null {
  const p = new URLSearchParams(search);
  const lat = parseFloat(p.get('lat') || '');
  const lon = parseFloat(p.get('lon') || '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function writeLatLonQuery(lat: number, lon: number): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.set('lat', lat.toFixed(5));
  url.searchParams.set('lon', lon.toFixed(5));
  window.history.replaceState(null, '', url);
}

export async function reverseNominatim(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      { headers: NOMINATIM_UA },
    );
    const hit = await res.json();
    if (hit) return formatNominatimName(hit);
  } catch {
    /* offline */
  }
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}
