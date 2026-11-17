export type DayPhase = 'day' | 'dusk' | 'night' | 'dawn';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
  solarNoon: Date;
}

function toJulianDay(date: Date): number {
  return date.getTime() / 86_400_000 - 0.5 + 24_4500.5;
}

function normalizeDegrees(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

/** Solar declination (degrees) for a given Julian day. */
function solarDeclination(jd: number): number {
  const n = jd - 2_451_545.0;
  const g = normalizeDegrees(357.529 + 0.98560028 * n);
  const q = 280.459 + 0.98564736 * n;
  const L = normalizeDegrees(q + 1.915 * Math.sin(g * DEG) + 0.02 * Math.sin(2 * g * DEG));
  const e = 23.439 - 0.00000036 * n;
  const sinDec = Math.sin(e * DEG) * Math.sin(L * DEG);
  return Math.asin(sinDec) * RAD;
}

function equationOfTimeMinutes(jd: number): number {
  const n = jd - 2_451_545.0;
  const g = normalizeDegrees(357.529 + 0.98560028 * n);
  const C = (1.9148 * Math.sin(g * DEG) + 0.02 * Math.sin(2 * g * DEG) + 0.0003 * Math.sin(3 * g * DEG)) * RAD;
  const lambda = normalizeDegrees(280.466 + 0.98564736 * n + C);
  const e = 23.439 - 0.00000036 * n;
  const y = Math.tan((e * DEG) / 2) ** 2;
  const q =
    y * Math.sin(2 * lambda * DEG) -
    2 * 0.0167 * Math.sin(g * DEG) +
    4 * 0.0167 * y * Math.sin(g * DEG) * Math.cos(2 * lambda * DEG) -
    0.5 * y * y * Math.sin(4 * lambda * DEG) -
    1.25 * 0.0167 * 0.0167 * Math.sin(2 * g * DEG);
  return q * 4 * RAD;
}

function solarTimeHours(date: Date, lon: number, jd: number): number {
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const eot = equationOfTimeMinutes(jd);
  return utcHours + lon / 15 + eot / 60;
}

/** Approximate sun altitude in degrees (negative = below horizon). */
export function sunAltitude(lat: number, lon: number, when: Date): number {
  const jd = toJulianDay(when);
  const decl = solarDeclination(jd) * DEG;
  const latRad = lat * DEG;
  const hourAngle = (solarTimeHours(when, lon, jd) - 12) * 15 * DEG;
  const altRad = Math.asin(
    Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle),
  );
  return altRad * RAD;
}

function eventTimeUtc(
  lat: number,
  lon: number,
  jd: number,
  zenithDeg: number,
  rise: boolean,
): Date {
  const decl = solarDeclination(jd) * DEG;
  const latRad = lat * DEG;
  const cosH =
    (Math.cos(zenithDeg * DEG) - Math.sin(latRad) * Math.sin(decl)) / (Math.cos(latRad) * Math.cos(decl));
  if (cosH > 1 || cosH < -1) {
    const noon = new Date((jd - 2_451_544.5) * 86_400_000);
    return noon;
  }
  const H = Math.acos(cosH) * RAD;
  const eot = equationOfTimeMinutes(jd);
  const offset = rise ? -H / 15 : H / 15;
  const utcHours = 12 + offset - lon / 15 - eot / 60;
  const base = new Date((jd - 2_451_544.5) * 86_400_000);
  const utcMs = Date.UTC(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    base.getUTCDate(),
    Math.floor(utcHours),
    Math.round((utcHours % 1) * 60),
    0,
    0,
  );
  return new Date(utcMs);
}

/** Civil sunrise/sunset and solar noon for the given calendar day (approximate). */
export function approxSunriseSunset(lat: number, lon: number, day: Date): SunTimes {
  const noonLocal = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0, 0);
  const jd = toJulianDay(noonLocal);
  const zenith = 90.833; // official sun rise/set
  return {
    sunrise: eventTimeUtc(lat, lon, jd, zenith, true),
    sunset: eventTimeUtc(lat, lon, jd, zenith, false),
    solarNoon: eventTimeUtc(lat, lon, jd, 90, true),
  };
}

/** Classify time of day from sun angle and civil twilight windows. */
export function getDayPhase(lat: number, lon: number, when: Date): DayPhase {
  const alt = sunAltitude(lat, lon, when);
  const { sunrise, sunset } = approxSunriseSunset(lat, lon, when);
  const t = when.getTime();
  const civilTwilightMs = 45 * 60_000;

  if (alt >= 2) return 'day';
  if (alt <= -6) return 'night';

  if (t >= sunrise.getTime() - civilTwilightMs && t < sunrise.getTime() + 30 * 60_000) {
    return 'dawn';
  }
  if (t >= sunset.getTime() - 30 * 60_000 && t <= sunset.getTime() + civilTwilightMs) {
    return 'dusk';
  }

  if (alt > 0) return 'day';
  if (t < sunrise.getTime()) return 'night';
  if (t > sunset.getTime()) return 'night';
  return alt >= -3 ? 'dusk' : 'night';
}