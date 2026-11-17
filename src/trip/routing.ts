const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const STRAIGHT_SEGMENTS = 48;
const FALLBACK_SPEED_MPS = 22; // ~49 mph driving average

export interface RoutePoint {
  lat: number;
  lon: number;
}

export interface RouteResult {
  coordinates: RoutePoint[];
  durationSeconds: number;
  distanceMeters: number;
  source: 'osrm' | 'straight';
}

const METERS_PER_DEG_LAT = 111_320;

function metersPerDegLon(lat: number): number {
  return METERS_PER_DEG_LAT * Math.max(0.12, Math.cos((lat * Math.PI) / 180));
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function straightLineRoute(lat1: number, lon1: number, lat2: number, lon2: number): RouteResult {
  const coordinates: RoutePoint[] = [];
  for (let i = 0; i <= STRAIGHT_SEGMENTS; i += 1) {
    const t = i / STRAIGHT_SEGMENTS;
    coordinates.push({
      lat: lat1 + (lat2 - lat1) * t,
      lon: lon1 + (lon2 - lon1) * t,
    });
  }
  const distanceMeters = haversineMeters(lat1, lon1, lat2, lon2);
  return {
    coordinates,
    durationSeconds: distanceMeters / FALLBACK_SPEED_MPS,
    distanceMeters,
    source: 'straight',
  };
}

interface OsrmRouteJson {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][] };
  }>;
}

/** Driving route via public OSRM; falls back to geodesic polyline on failure. */
export async function fetchRoute(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): Promise<RouteResult> {
  const url = `${OSRM_BASE}/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return straightLineRoute(lat1, lon1, lat2, lon2);
    const data = (await res.json()) as OsrmRouteJson;
    const route = data.routes?.[0];
    const raw = route?.geometry?.coordinates;
    if (data.code !== 'Ok' || !route || !raw?.length) {
      return straightLineRoute(lat1, lon1, lat2, lon2);
    }
    const coordinates = raw.map(([lon, lat]) => ({ lat, lon }));
    const distanceMeters =
      typeof route.distance === 'number' && route.distance > 0
        ? route.distance
        : haversineMeters(lat1, lon1, lat2, lon2);
    const durationSeconds =
      typeof route.duration === 'number' && route.duration > 0
        ? route.duration
        : distanceMeters / FALLBACK_SPEED_MPS;
    return { coordinates, durationSeconds, distanceMeters, source: 'osrm' };
  } catch {
    return straightLineRoute(lat1, lon1, lat2, lon2);
  }
}

/** Sum polyline length in meters (for progress along a cached route). */
export function polylineLengthMeters(points: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    total += haversineMeters(a.lat, a.lon, b.lat, b.lon);
  }
  return total;
}

/** Rough map meters from degree deltas at a given latitude. */
export function degDeltaToMeters(dLat: number, dLon: number, lat: number): number {
  return Math.hypot(dLat * METERS_PER_DEG_LAT, dLon * metersPerDegLon(lat));
}