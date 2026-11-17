/** Feature flags for experiments. Override with ?flag=name or localStorage pillion.flags */

export interface FeatureFlags {
  gyroAim: boolean;
  weather: boolean;
  structuralCollapse: boolean;
  aimAssist: boolean;
  binarySnap: boolean;
  cinema: boolean;
  photoMode: boolean;
  roadTrip: boolean;
}

const DEFAULTS: FeatureFlags = {
  gyroAim: true,
  weather: true,
  structuralCollapse: true,
  aimAssist: true,
  binarySnap: true,
  cinema: true,
  photoMode: true,
  roadTrip: true,
};

let cached: FeatureFlags | null = null;

export function flags(): FeatureFlags {
  if (cached) return cached;
  const out = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem('pillion.flags');
    if (raw) Object.assign(out, JSON.parse(raw));
  } catch {
    /* ignore */
  }
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search);
    for (const key of Object.keys(out) as (keyof FeatureFlags)[]) {
      if (q.get(key) === '1') out[key] = true;
      if (q.get(key) === '0') out[key] = false;
    }
  }
  cached = out;
  return out;
}
