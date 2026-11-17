const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LS_PREFIX = 'pillion.elev.';

const mem = new Map<string, { at: number; meters: number }>();

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)}_${lon.toFixed(4)}`;
}

function readLs(key: string): number | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const { at, meters } = JSON.parse(raw) as { at: number; meters: number };
    if (Date.now() - at > TTL_MS) return null;
    return meters;
  } catch {
    return null;
  }
}

function writeLs(key: string, meters: number): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify({ at: Date.now(), meters }));
  } catch {
    /* ignore */
  }
}

/**
 * Approximate ground elevation (meters AMSL) via Open-Meteo elevation API.
 * Cached in memory and localStorage for 30 days.
 */
export async function fetchElevation(lat: number, lon: number): Promise<number | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const key = cacheKey(lat, lon);
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at <= TTL_MS) return hit.meters;

  const fromLs = readLs(key);
  if (fromLs !== null) {
    mem.set(key, { at: Date.now(), meters: fromLs });
    return fromLs;
  }

  try {
    const url = `${ELEVATION_API}?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { elevation?: number[] };
    const raw = body.elevation?.[0];
    if (raw === undefined || !Number.isFinite(raw)) return null;
    const meters = raw;
    mem.set(key, { at: Date.now(), meters });
    writeLs(key, meters);
    return meters;
  } catch {
    return null;
  }
}

/** Batch elevations for chunk corners (max ~20 points per Open-Meteo call). */
export async function fetchElevations(
  points: Array<{ lat: number; lon: number }>,
): Promise<Array<number | null>> {
  if (!points.length) return [];
  const out: Array<number | null> = [];
  const needFetch: { index: number; lat: number; lon: number }[] = [];

  for (let i = 0; i < points.length; i++) {
    const { lat, lon } = points[i];
    const key = cacheKey(lat, lon);
    const hit = mem.get(key);
    if (hit && Date.now() - hit.at <= TTL_MS) {
      out[i] = hit.meters;
      continue;
    }
    const ls = readLs(key);
    if (ls !== null) {
      mem.set(key, { at: Date.now(), meters: ls });
      out[i] = ls;
      continue;
    }
    needFetch.push({ index: i, lat, lon });
    out[i] = null;
  }

  if (!needFetch.length) return out;

  try {
    const lats = needFetch.map((p) => p.lat.toFixed(5)).join(',');
    const lons = needFetch.map((p) => p.lon.toFixed(5)).join(',');
    const url = `${ELEVATION_API}?latitude=${lats}&longitude=${lons}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return out;
    const body = (await res.json()) as { elevation?: number[] };
    const elevations = body.elevation ?? [];
    needFetch.forEach((p, j) => {
      const meters = elevations[j];
      if (!Number.isFinite(meters)) return;
      const key = cacheKey(p.lat, p.lon);
      mem.set(key, { at: Date.now(), meters });
      writeLs(key, meters);
      out[p.index] = meters;
    });
  } catch {
    /* offline */
  }
  return out;
}