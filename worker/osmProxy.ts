/**
 * Proxies Overpass OSM queries so the browser isn't blocked by CORS / flaky public mirrors.
 * GET /api/osm?lat=&lon=  or  ?s=&w=&n=&e=
 */
import { buildOverpassQueryFromBBox } from '../src/geo/overpassQuery';
import { bboxFromCenter, padBBox, type GeoBBox } from '../src/geo/projection';

export interface Env {
  ASSETS: Fetcher;
}

const MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function fetchOverpass(query: string): Promise<Response | null> {
  for (const mirror of MIRRORS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(mirror, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        headers: {
          'User-Agent': 'pillion.ibm.io/1.0 (cozy apocalypse diorama)',
        },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) return res;
    } catch {
      // try next mirror
    }
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/osm') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: corsHeaders(request),
        });
      }

      const bbox = bboxFromRequest(url);
      if (!bbox) {
        return json({ error: 'lat/lon or s,w,n,e required' }, 400, request);
      }

      const upstream = await fetchOverpass(buildOverpassQueryFromBBox(bbox));
      if (!upstream) {
        return json({ error: 'overpass_unavailable', elements: [] }, 502, request);
      }

      const body = await upstream.text();
      return new Response(body, {
        status: 200,
        headers: {
          ...corsHeaders(request),
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};

function q5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

function bboxFromRequest(url: URL): GeoBBox | null {
  const s = parseFloat(url.searchParams.get('s') || '');
  const w = parseFloat(url.searchParams.get('w') || '');
  const n = parseFloat(url.searchParams.get('n') || '');
  const e = parseFloat(url.searchParams.get('e') || '');
  if ([s, w, n, e].every(Number.isFinite)) {
    const lat = parseFloat(url.searchParams.get('lat') || '') || (s + n) / 2;
    const lon = parseFloat(url.searchParams.get('lon') || '') || (w + e) / 2;
    return { south: q5(s), west: q5(w), north: q5(n), east: q5(e), curLat: lat, curLon: lon };
  }
  const lat = parseFloat(url.searchParams.get('lat') || '');
  const lon = parseFloat(url.searchParams.get('lon') || '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return padBBox(bboxFromCenter(lat, lon));
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function json(data: unknown, status: number, request: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
