const OPEN_METEO =
  'https://api.open-meteo.com/v1/forecast?current=temperature_2m,precipitation,rain,snowfall,weather_code&timezone=auto';

const CACHE_TTL_MS = 10 * 60 * 1000;

export interface WeatherSnapshot {
  tempC: number;
  rain: boolean;
  fog: boolean;
  snow: boolean;
  fetchedAt: number;
}

interface CacheEntry {
  lat: number;
  lon: number;
  expires: number;
  data: WeatherSnapshot;
}

let cache: CacheEntry | null = null;

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

function isFogCode(code: number): boolean {
  return code === 45 || code === 48;
}

function isRainCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code === 95 || code === 96 || code === 99;
}

function isSnowCode(code: number): boolean {
  return (code >= 71 && code <= 77) || (code >= 85 && code <= 86);
}

interface OpenMeteoCurrent {
  time?: string;
  temperature_2m?: number;
  precipitation?: number;
  rain?: number;
  snowfall?: number;
  weather_code?: number;
}

interface OpenMeteoJson {
  current?: OpenMeteoCurrent;
}

/** Current conditions from Open-Meteo; lat/lon rounded to ~100 m, cached 10 minutes. */
export async function fetchWeather(lat: number, lon: number): Promise<WeatherSnapshot> {
  const latKey = Math.round(lat * 1000) / 1000;
  const lonKey = Math.round(lon * 1000) / 1000;
  const now = Date.now();
  if (
    cache &&
    cache.expires > now &&
    cacheKey(cache.lat, cache.lon) === cacheKey(latKey, lonKey)
  ) {
    return cache.data;
  }

  const url = `${OPEN_METEO}&latitude=${latKey}&longitude=${lonKey}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`weather ${res.status}`);
    const json = (await res.json()) as OpenMeteoJson;
    const cur = json.current;
    const code = typeof cur?.weather_code === 'number' ? cur.weather_code : 0;
    const tempC = typeof cur?.temperature_2m === 'number' ? cur.temperature_2m : 0;
    const precip = typeof cur?.precipitation === 'number' ? cur.precipitation : 0;
    const rainMm = typeof cur?.rain === 'number' ? cur.rain : 0;
    const snowCm = typeof cur?.snowfall === 'number' ? cur.snowfall : 0;

    const data: WeatherSnapshot = {
      tempC,
      rain: rainMm > 0.05 || precip > 0.05 || isRainCode(code),
      fog: isFogCode(code),
      snow: snowCm > 0.05 || isSnowCode(code),
      fetchedAt: now,
    };
    cache = { lat: latKey, lon: lonKey, expires: now + CACHE_TTL_MS, data };
    return data;
  } catch {
    const fallback: WeatherSnapshot = {
      tempC: 18,
      rain: false,
      fog: false,
      snow: false,
      fetchedAt: now,
    };
    cache = { lat: latKey, lon: lonKey, expires: now + 60_000, data: fallback };
    return fallback;
  }
}

export function clearWeatherCache(): void {
  cache = null;
}